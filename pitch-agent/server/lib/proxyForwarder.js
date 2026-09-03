/**
 * Local credential-injecting proxy forwarder.
 *
 * Chromium authenticates to a proxy only when challenged: it sends CONNECT
 * with no credentials, expects "407 + Proxy-Authenticate", then retries with
 * the password. Some residential gateways don't answer an unauthenticated
 * CONNECT with a clean 407 (they time out or refuse instead), and Chromium
 * then fails with ERR_TUNNEL_CONNECTION_FAILED — while any client that
 * sends credentials up front (curl, Node, the provider's own tester) works.
 *
 * This forwarder listens on 127.0.0.1, accepts Chromium's unauthenticated
 * CONNECT / plain-HTTP requests, and relays each one to the real upstream
 * proxy with Proxy-Authorization already attached. Chromium is pointed at
 * the forwarder instead of the upstream, so the credentials never go
 * through the challenge dance (and never appear on the command line).
 */
const http = require('http');

const UPSTREAM_CONNECT_TIMEOUT_MS = 30000;

/**
 * @param {{server: string, username: string, password: string|null}} proxy
 *   as returned by scraper.parseProxy(); server must be http://host:port
 * @returns {Promise<{url: string, port: number, close: () => Promise<void>}>}
 */
function startProxyForwarder(proxy) {
  const upstream = new URL(proxy.server);
  if (upstream.protocol !== 'http:') {
    return Promise.reject(new Error(`forwarder supports http:// upstreams only, got ${upstream.protocol}`));
  }
  const upstreamHost = upstream.hostname;
  const upstreamPort = Number(upstream.port) || 80;
  const auth = 'Basic ' + Buffer.from(`${proxy.username}:${proxy.password || ''}`).toString('base64');

  const server = http.createServer();
  const sockets = new Set();
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });

  // Plain http:// requests (rare — FA is https, but redirects can go via http):
  // forward as an absolute-URI request to the upstream proxy.
  server.on('request', (req, res) => {
    const headers = { ...req.headers, 'proxy-authorization': auth };
    delete headers['proxy-connection'];
    const up = http.request(
      { host: upstreamHost, port: upstreamPort, method: req.method, path: req.url, headers, timeout: UPSTREAM_CONNECT_TIMEOUT_MS },
      (upRes) => { res.writeHead(upRes.statusCode, upRes.headers); upRes.pipe(res); }
    );
    up.on('timeout', () => up.destroy(new Error('upstream timed out')));
    up.on('error', (err) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`forwarder: ${err.message}`);
    });
    req.pipe(up);
  });

  // https:// tunnels: open our own CONNECT to the upstream with credentials,
  // then splice the two sockets together.
  server.on('connect', (req, clientSocket, head) => {
    const up = http.request({
      host: upstreamHost,
      port: upstreamPort,
      method: 'CONNECT',
      path: req.url,
      headers: { host: req.url, 'proxy-authorization': auth },
      timeout: UPSTREAM_CONNECT_TIMEOUT_MS,
    });
    const fail = (status, text) => {
      if (!clientSocket.destroyed) clientSocket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
    };
    up.on('connect', (upRes, upSocket, upHead) => {
      if (upRes.statusCode !== 200) {
        // Surface the gateway's real answer so Chromium's error (and our
        // logs) say what the upstream said, not just "tunnel failed".
        console.warn(`[proxy-forwarder] upstream answered CONNECT ${req.url} with HTTP ${upRes.statusCode}`);
        upSocket.destroy();
        return fail(upRes.statusCode, upRes.statusMessage || 'Proxy Error');
      }
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (upHead && upHead.length) clientSocket.write(upHead);
      if (head && head.length) upSocket.write(head);
      upSocket.pipe(clientSocket);
      clientSocket.pipe(upSocket);
      upSocket.on('error', () => clientSocket.destroy());
      clientSocket.on('error', () => upSocket.destroy());
      upSocket.on('close', () => clientSocket.destroy());
      clientSocket.on('close', () => upSocket.destroy());
    });
    up.on('timeout', () => up.destroy(new Error('upstream CONNECT timed out')));
    up.on('error', (err) => {
      console.warn(`[proxy-forwarder] upstream CONNECT ${req.url} failed: ${err.message}`);
      fail(502, 'Bad Gateway');
    });
    clientSocket.on('error', () => up.destroy());
    up.end();
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        close: () => new Promise((done) => {
          for (const s of sockets) s.destroy();
          server.close(() => done());
        }),
      });
    });
  });
}

module.exports = { startProxyForwarder };

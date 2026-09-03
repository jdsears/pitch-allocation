/**
 * One-click proxy diagnostic for support conversations.
 *
 * Answers the questions a proxy provider always asks when the app can reach
 * FA's tester but the server cannot: "what is your source IP?" and "what
 * exactly happens when you connect?". Uses raw Node HTTP (no puppeteer), so
 * the result is the unvarnished network truth.
 *
 * Two tunnels are tried: one to a neutral IP-echo service (proves the
 * gateway accepts this server at all) and one to FA Full-Time itself (the
 * only destination the scraper needs — a provider can accept the tunnel in
 * general yet refuse a specific destination host).
 */
const https = require('https');
const http = require('http');
const tls = require('tls');

const FA_HOST = 'fulltime.thefa.com';

function directEgressIp(timeoutMs = 8000) {
  return new Promise((resolve) => {
    const req = https.get('https://api.ipify.org?format=json', { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve({ ok: true, ip: JSON.parse(body).ip }); }
        catch { resolve({ ok: false, error: `unexpected response: ${body.slice(0, 80)}` }); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timed out')); });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
  });
}

// CONNECT through the proxy to host:443, TLS-wrap, issue one GET and hand
// the raw response text to `parse`, which turns it into the result object.
function throughProxy(proxy, { host, path, parse }, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const auth = proxy.username
      ? 'Basic ' + Buffer.from(`${proxy.username}:${proxy.password || ''}`).toString('base64')
      : null;
    const u = new URL(proxy.server);
    const req = http.request({
      host: u.hostname,
      port: u.port || 80,
      method: 'CONNECT',
      path: `${host}:443`,
      timeout: timeoutMs,
      headers: auth ? { 'Proxy-Authorization': auth } : {},
    });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return resolve({ ok: false, stage: 'CONNECT', statusCode: res.statusCode, error: `proxy answered CONNECT to ${host} with HTTP ${res.statusCode}` });
      }
      const tlsSocket = tls.connect({ socket, servername: host }, () => {
        tlsSocket.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: Mozilla/5.0\r\nConnection: close\r\n\r\n`);
      });
      let body = '';
      const timer = setTimeout(() => tlsSocket.destroy(new Error(`no response from ${host} within ${timeoutMs}ms`)), timeoutMs);
      tlsSocket.on('data', (c) => { body += c; });
      tlsSocket.on('end', () => { clearTimeout(timer); resolve(parse(body)); });
      tlsSocket.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, stage: 'TLS', error: err.message }); });
    });
    req.on('timeout', () => { req.destroy(new Error('CONNECT timed out')); });
    req.on('error', (err) => resolve({ ok: false, stage: 'CONNECT', error: err.message }));
    req.end();
  });
}

const IPIFY_TARGET = {
  host: 'api.ipify.org',
  path: '/?format=json',
  parse: (body) => {
    const m = body.match(/"ip"\s*:\s*"([^"]+)"/);
    return m ? { ok: true, exitIp: m[1] } : { ok: false, stage: 'response', error: `unexpected body: ${body.slice(-120)}` };
  },
};

const FA_TARGET = {
  host: FA_HOST,
  path: '/home/index.html',
  parse: (body) => {
    const status = body.match(/^HTTP\/1\.[01] (\d{3})/);
    if (!status) return { ok: false, stage: 'response', error: `no HTTP status from FA: ${body.slice(0, 120)}` };
    const code = Number(status[1]);
    // Any real HTTP answer (even a redirect) means the tunnel reached FA.
    return code < 500
      ? { ok: true, statusCode: code }
      : { ok: false, stage: 'response', statusCode: code, error: `FA answered HTTP ${code}` };
  },
};

function interpret(tunnel, fa) {
  if (tunnel.ok && fa.ok) {
    return 'Tunnel works and FA Full-Time answers through it. A failed scrape was a transient outage — try Scrape now again; if it keeps failing, FA may be blocking the proxy exit IP.';
  }
  if (tunnel.ok && !fa.ok) {
    return `Tunnel works in general but NOT to ${FA_HOST}. Give the provider this exact error — their gateway is refusing that destination host.`;
  }
  return 'This server cannot tunnel through the proxy at all. Give the provider serverEgressIp and this exact error — likely their gateway is filtering this source IP.';
}

async function proxySelfTest(parseProxy) {
  const proxy = parseProxy();
  const notConfigured = { ok: false, error: 'SCRAPE_PROXY not configured' };
  const [direct, tunneled, fa] = await Promise.all([
    directEgressIp(),
    proxy ? throughProxy(proxy, IPIFY_TARGET) : Promise.resolve(notConfigured),
    proxy ? throughProxy(proxy, FA_TARGET) : Promise.resolve(notConfigured),
  ]);
  return {
    ranAt: new Date().toISOString(),
    serverEgressIp: direct,           // give this IP to the proxy provider
    proxyConfigured: !!proxy,
    proxyServer: proxy ? proxy.server : null,
    connectionThroughProxy: tunneled, // ok:true + exitIp = gateway accepts this server
    faThroughProxy: fa,               // ok:true + statusCode = FA reachable via the proxy
    interpretation: interpret(tunneled, fa),
  };
}

module.exports = { proxySelfTest };

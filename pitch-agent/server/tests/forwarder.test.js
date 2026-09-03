const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { startProxyForwarder } = require('../lib/proxyForwarder');

const CREDS = { username: 'user', password: 'secret_country-gb' };
const EXPECTED_AUTH = 'Basic ' + Buffer.from('user:secret_country-gb').toString('base64');

// A stand-in for the residential gateway: requires credentials on the
// CONNECT itself (no 407 challenge), then echoes tunnel bytes back.
function fakeUpstream() {
  const server = http.createServer();
  server.on('connect', (req, socket, head) => {
    if (req.headers['proxy-authorization'] !== EXPECTED_AUTH) {
      socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="x"\r\nConnection: close\r\n\r\n');
      return;
    }
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) socket.write(head);
    socket.on('data', (d) => socket.write(d));
  });
  server.on('request', (req, res) => {
    if (req.headers['proxy-authorization'] !== EXPECTED_AUTH) { res.writeHead(407); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`got ${req.method} ${req.url}`);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

function connectVia(port, target) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'CONNECT', path: target });
    req.on('connect', (res, socket) => resolve({ res, socket }));
    req.on('error', reject);
    req.end();
  });
}

test('forwarder injects credentials on CONNECT and splices the tunnel', async () => {
  const up = await fakeUpstream();
  const fwd = await startProxyForwarder({ server: `http://127.0.0.1:${up.port}`, ...CREDS });
  try {
    const { res, socket } = await connectVia(fwd.port, 'fulltime.thefa.com:443');
    assert.equal(res.statusCode, 200);
    const echoed = await new Promise((resolve) => { socket.once('data', (d) => resolve(d.toString())); socket.write('ping'); });
    assert.equal(echoed, 'ping');
    socket.destroy();
  } finally {
    await fwd.close();
    up.server.close();
  }
});

test('forwarder relays the upstream status when the gateway refuses the tunnel', async () => {
  const up = await fakeUpstream();
  // Wrong password → fake gateway answers 407; Chromium would then see 407 rather than a dead socket
  const fwd = await startProxyForwarder({ server: `http://127.0.0.1:${up.port}`, username: 'user', password: 'wrong' });
  try {
    const { res, socket } = await connectVia(fwd.port, 'fulltime.thefa.com:443');
    assert.equal(res.statusCode, 407);
    socket.destroy();
  } finally {
    await fwd.close();
    up.server.close();
  }
});

test('forwarder forwards plain http requests with credentials attached', async () => {
  const up = await fakeUpstream();
  const fwd = await startProxyForwarder({ server: `http://127.0.0.1:${up.port}`, ...CREDS });
  try {
    const body = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: fwd.port, path: 'http://example.test/x', headers: { host: 'example.test' } }, (res) => {
        let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, b }));
      }).on('error', reject);
    });
    assert.equal(body.status, 200);
    assert.equal(body.b, 'got GET http://example.test/x');
  } finally {
    await fwd.close();
    up.server.close();
  }
});

test('forwarder rejects non-http upstreams so socks proxies fall back to browser auth', async () => {
  await assert.rejects(startProxyForwarder({ server: 'socks5://127.0.0.1:1080', ...CREDS }), /http:\/\/ upstreams only/);
});

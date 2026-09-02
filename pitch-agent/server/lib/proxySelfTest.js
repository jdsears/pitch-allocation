/**
 * One-click proxy diagnostic for support conversations.
 *
 * Answers the two questions a proxy provider always asks when the app can
 * reach FA's tester but the server cannot: "what is your source IP?" and
 * "what exactly happens when you connect?". Uses raw Node HTTP (no
 * puppeteer), so the result is the unvarnished network truth.
 */
const https = require('https');
const http = require('http');
const tls = require('tls');

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

function throughProxy(proxy, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const auth = proxy.username
      ? 'Basic ' + Buffer.from(`${proxy.username}:${proxy.password || ''}`).toString('base64')
      : null;
    const u = new URL(proxy.server);
    const req = http.request({
      host: u.hostname,
      port: u.port || 80,
      method: 'CONNECT',
      path: 'api.ipify.org:443',
      timeout: timeoutMs,
      headers: auth ? { 'Proxy-Authorization': auth } : {},
    });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return resolve({ ok: false, stage: 'CONNECT', statusCode: res.statusCode, error: `proxy answered CONNECT with HTTP ${res.statusCode}` });
      }
      const tlsSocket = tls.connect({ socket, servername: 'api.ipify.org' }, () => {
        tlsSocket.write('GET /?format=json HTTP/1.1\r\nHost: api.ipify.org\r\nConnection: close\r\n\r\n');
      });
      let body = '';
      tlsSocket.on('data', (c) => { body += c; });
      tlsSocket.on('end', () => {
        const m = body.match(/"ip"\s*:\s*"([^"]+)"/);
        resolve(m ? { ok: true, exitIp: m[1] } : { ok: false, stage: 'response', error: `unexpected body: ${body.slice(-120)}` });
      });
      tlsSocket.on('error', (err) => resolve({ ok: false, stage: 'TLS', error: err.message }));
    });
    req.on('timeout', () => { req.destroy(new Error('CONNECT timed out')); });
    req.on('error', (err) => resolve({ ok: false, stage: 'CONNECT', error: err.message }));
    req.end();
  });
}

async function proxySelfTest(parseProxy) {
  const proxy = parseProxy();
  const [direct, tunneled] = await Promise.all([
    directEgressIp(),
    proxy ? throughProxy(proxy) : Promise.resolve({ ok: false, error: 'SCRAPE_PROXY not configured' }),
  ]);
  return {
    ranAt: new Date().toISOString(),
    serverEgressIp: direct,           // give this IP to the proxy provider
    proxyConfigured: !!proxy,
    proxyServer: proxy ? proxy.server : null,
    connectionThroughProxy: tunneled, // ok:true + exitIp = tunnel works
    interpretation: tunneled.ok
      ? 'Tunnel works from this server — if scrapes still fail, the problem is beyond the proxy (e.g. FA).'
      : 'This server cannot tunnel through the proxy. Give the provider serverEgressIp and this exact error — likely their gateway is filtering this source IP.',
  };
}

module.exports = { proxySelfTest };

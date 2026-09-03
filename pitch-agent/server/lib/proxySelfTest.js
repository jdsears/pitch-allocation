/**
 * One-click proxy diagnostic for support conversations.
 *
 * Answers the questions a proxy provider always asks when the app can reach
 * FA's tester but the server cannot: "what is your source IP?" and "what
 * exactly happens when you connect?". Uses raw Node HTTP (no puppeteer), so
 * the result is the unvarnished network truth.
 *
 * Two destinations are tried, several times each: a neutral IP-echo service
 * (proves the gateway accepts this server at all) and FA Full-Time itself
 * (the only destination the scraper needs — a provider can accept the tunnel
 * in general yet refuse a specific host). Repeating the attempts matters
 * because a rotating residential proxy lands each CONNECT on a different
 * exit: a pool having a bad hour shows as a low success rate, not a hard no.
 */
const https = require('https');
const http = require('http');
const tls = require('tls');

const FA_HOST = 'fulltime.thefa.com';
const ATTEMPTS = 4;

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

// What a browser does first: CONNECT with no credentials. For Chromium's
// challenge-based auth to work the gateway must answer 407 with a
// Proxy-Authenticate header; anything else and the browser gives up with
// ERR_TUNNEL_CONNECTION_FAILED even though credentials-up-front clients work.
function authChallenge(proxy, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const u = new URL(proxy.server);
    const req = http.request({ host: u.hostname, port: u.port || 80, method: 'CONNECT', path: 'api.ipify.org:443', timeout: timeoutMs });
    req.on('connect', (res, socket) => {
      socket.destroy();
      const proxyAuthenticate = res.headers['proxy-authenticate'] || null;
      resolve({ ok: res.statusCode === 407 && !!proxyAuthenticate, statusCode: res.statusCode, proxyAuthenticate });
    });
    req.on('timeout', () => { req.destroy(new Error('CONNECT timed out')); });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.end();
  });
}

function describeChallenge(challenge) {
  if (!challenge || challenge.ok) return null;
  const got = challenge.statusCode
    ? `HTTP ${challenge.statusCode}${challenge.statusCode === 407 && !challenge.proxyAuthenticate ? ' with no Proxy-Authenticate header' : ''}`
    : challenge.error;
  return `An unauthenticated CONNECT gets ${got} instead of a 407 challenge, so a browser authenticating on challenge cannot connect even though credentials-up-front clients can. The scraper sends credentials up front via its local forwarder, so this should not affect it.`;
}

async function repeated(proxy, target) {
  const attempts = await Promise.all(Array.from({ length: ATTEMPTS }, () => throughProxy(proxy, target)));
  const successes = attempts.filter((a) => a.ok).length;
  return { ok: successes > 0, successes, attempts: attempts.length, results: attempts };
}

// Explain a CONNECT outcome in provider-support terms. The status code the
// gateway answers with is the whole story: 407 is our credentials, 403 is a
// policy block, 5xx is the gateway failing to reach an exit (their side,
// usually intermittent), and no status at all means we never reached the
// gateway.
function describeConnect(results) {
  const failures = results.filter((r) => !r.ok);
  if (!failures.length) return null;
  const codes = [...new Set(failures.map((r) => r.statusCode).filter(Boolean))];
  if (codes.includes(407)) return 'the proxy rejected our credentials (HTTP 407) — check SCRAPE_PROXY matches the provider dashboard';
  if (codes.includes(403)) return 'the proxy refused the tunnel by policy (HTTP 403) — ask the provider whether this server IP or the destination host is blocked';
  if (codes.some((c) => c >= 500)) return `the proxy gateway accepted us but could not reach a working exit (HTTP ${codes.filter((c) => c >= 500).join('/')}) — a provider-side pool problem, usually intermittent; retries and time are the fix, and the provider can confirm a pool incident`;
  return `the tunnel failed before the gateway answered (${failures[0].error}) — a network-path problem between this server and the proxy`;
}

function interpret(tunnel, fa) {
  const rate = (r) => `${r.successes}/${r.attempts}`;
  if (tunnel.successes === tunnel.attempts && fa.successes === fa.attempts) {
    return 'Every attempt succeeded, to both the neutral host and FA Full-Time. A failed scrape was a passing outage — try Scrape now again.';
  }
  if (tunnel.ok && !fa.ok) {
    return `Tunnel works to the neutral host (${rate(tunnel)}) but never to ${FA_HOST} (${rate(fa)}): ${describeConnect(fa.results)}.`;
  }
  if (tunnel.ok || fa.ok) {
    return `Tunnel is intermittent right now — neutral host ${rate(tunnel)}, FA ${rate(fa)}: ${describeConnect([...tunnel.results, ...fa.results])}. The scraper retries with backoff, so the next run may well succeed.`;
  }
  return `This server cannot tunnel through the proxy at all (0/${tunnel.attempts + fa.attempts}): ${describeConnect([...tunnel.results, ...fa.results])}.`;
}

// IPRoyal carries geo/session targeting as underscore-separated suffixes on
// the password (e.g. secret_country-gb_city-norwich). Surface just those
// suffixes so the live targeting can be verified without exposing the secret.
function proxyTargeting(password) {
  if (!password) return null;
  const parts = String(password).split('_').slice(1).filter(Boolean);
  return parts.length ? parts.join(', ') : '(none)';
}

async function proxySelfTest(parseProxy) {
  const proxy = parseProxy();
  const notConfigured = { ok: false, successes: 0, attempts: 0, results: [{ ok: false, error: 'SCRAPE_PROXY not configured' }] };
  const [direct, tunneled, fa, challenge] = await Promise.all([
    directEgressIp(),
    proxy ? repeated(proxy, IPIFY_TARGET) : Promise.resolve(notConfigured),
    proxy ? repeated(proxy, FA_TARGET) : Promise.resolve(notConfigured),
    proxy && proxy.username ? authChallenge(proxy) : Promise.resolve(null),
  ]);
  const notes = [proxy ? interpret(tunneled, fa) : 'SCRAPE_PROXY is not configured — the scraper will hit FA directly and be blocked.', describeChallenge(challenge)].filter(Boolean);
  return {
    ranAt: new Date().toISOString(),
    serverEgressIp: direct,           // give this IP to the proxy provider
    proxyConfigured: !!proxy,
    proxyServer: proxy ? proxy.server : null,
    proxyTargeting: proxy ? proxyTargeting(proxy.password) : null, // e.g. "country-gb" — never the secret
    connectionThroughProxy: tunneled, // successes/attempts to a neutral host, credentials sent up front
    faThroughProxy: fa,               // successes/attempts to FA Full-Time, credentials sent up front
    browserStyleChallenge: challenge, // what the gateway answers a bare CONNECT (ok = proper 407 challenge)
    interpretation: notes.join(' '),
  };
}

module.exports = { proxySelfTest, interpret, describeConnect, describeChallenge, proxyTargeting };

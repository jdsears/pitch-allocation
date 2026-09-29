/**
 * A refused FA page must fail the scrape, not pass as "found 0".
 *
 * 29/09/2026: the scrape proxy's balance ran out (the gateway answered 402)
 * and FA Full-Time answers blocked requests with 403. The scraper never
 * looked at the page's status: it waited for a table, parsed nothing and
 * recorded a successful run with 0 fixtures.
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const { describeConnect } = require('../lib/proxySelfTest');

test('the proxy self-test names a 402 as an empty proxy account', () => {
  const text = describeConnect([{ ok: false, statusCode: 402 }, { ok: false, statusCode: 402 }]);
  assert.match(text, /out of traffic or its plan has lapsed/);
  assert.match(text, /HTTP 402/);
});

const chromium = process.env.PUPPETEER_EXECUTABLE_PATH;
test('a 403 from FA fails the scrape with a reason', { skip: !(chromium && fs.existsSync(chromium)) && 'no Chromium (set PUPPETEER_EXECUTABLE_PATH)' }, async () => {
  process.env.NODE_ENV = 'production'; // use the system Chromium
  delete process.env.SCRAPE_PROXY;
  const { fetchRenderedHTML } = require('../services/scraper');
  const server = http.createServer((req, res) => {
    res.writeHead(403, { 'content-type': 'text/html' });
    res.end('<html><head><title>Access denied</title></head><body>Blocked</body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await assert.rejects(
      fetchRenderedHTML(`http://127.0.0.1:${server.address().port}/fixtures.html`),
      (err) => {
        assert.match(err.message, /refused the page \(HTTP 403\)/);
        assert.match(err.message, /no SCRAPE_PROXY is set/);
        return true;
      },
    );
  } finally {
    server.close();
  }
});

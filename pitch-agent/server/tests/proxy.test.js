/**
 * Tests for SCRAPE_PROXY parsing — credential stripping is easy to get wrong
 * and a mistake leaks the proxy password into Chromium's --proxy-server arg
 * (which shows up in process listings). No network/browser needed.
 *
 * parseProxy reads process.env.SCRAPE_PROXY, so each case sets/clears it.
 */
const test = require('node:test');
const assert = require('node:assert');
const { parseProxy } = require('../services/scraper');

function withProxy(value, fn) {
  const prev = process.env.SCRAPE_PROXY;
  if (value === null) delete process.env.SCRAPE_PROXY;
  else process.env.SCRAPE_PROXY = value;
  try { return fn(); }
  finally {
    if (prev === undefined) delete process.env.SCRAPE_PROXY;
    else process.env.SCRAPE_PROXY = prev;
  }
}

test('no proxy configured returns null', () => {
  withProxy(null, () => assert.equal(parseProxy(), null));
  withProxy('', () => assert.equal(parseProxy(), null));
  withProxy('   ', () => assert.equal(parseProxy(), null));
});

test('host:port without scheme defaults to http and no creds', () => {
  withProxy('proxy.example.com:8080', () => {
    const p = parseProxy();
    assert.equal(p.server, 'http://proxy.example.com:8080');
    assert.equal(p.username, null);
    assert.equal(p.password, null);
  });
});

test('credentials are split out, never left in the server string', () => {
  withProxy('http://user:s3cret@proxy.example.com:8080', () => {
    const p = parseProxy();
    assert.equal(p.server, 'http://proxy.example.com:8080', 'server must not contain creds');
    assert.equal(p.username, 'user');
    assert.equal(p.password, 's3cret');
    assert.ok(!p.server.includes('s3cret'), 'password must not leak into --proxy-server');
  });
});

test('non-http schemes (socks5) are preserved', () => {
  withProxy('socks5://10.0.0.1:1080', () => {
    const p = parseProxy();
    assert.equal(p.server, 'socks5://10.0.0.1:1080');
  });
});

test('url-encoded credentials are decoded', () => {
  withProxy('http://user%40club:p%40ss@proxy.example.com:3128', () => {
    const p = parseProxy();
    assert.equal(p.username, 'user@club');
    assert.equal(p.password, 'p@ss');
  });
});

test('malformed proxy is ignored, not thrown', () => {
  withProxy('http://[not-a-valid-url', () => {
    assert.equal(parseProxy(), null);
  });
});

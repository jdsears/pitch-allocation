/**
 * Regression tests for the FA Full-Time fixture parser.
 *
 * The 2026/27 markup broke the scrape silently: FA dropped the table's
 * .League-Results_Table class AND separates cell text with tabs/newlines,
 * so the old fallback (literal " VS " with spaces) matched nothing —
 * "scrape ran fine, found 0". The new-season sample below is reconstructed
 * from the /api/fixtures/debug output captured when diagnosing that bug.
 */
const test = require('node:test');
const assert = require('node:assert');
const { parseFixtures } = require('../services/scraper');

// Cell text separated by tabs/newlines, classless table — as FA serves 2026/27
const NEW_SEASON_HTML = `
<html><body>
<table>
  <tr>
    <th>Type</th><th>Date / Time</th><th>Home Team</th><th></th><th>Away Team</th>
    <th>Venue</th><th>Competition</th><th>Status / Notes</th>
  </tr>
  <tr>
    <td>10GC</td>
    <td>
\t\t\t\t05/09/26
\t\t\t\t10:00
\t\t</td>
    <td>
\t\t\tWymondham Town United F.C. U10 (U9) Gree
\t\t</td>
    <td></td>
    <td>
\t\t\tVS
\t\t</td>
    <td></td>
    <td>
\t\t\tMorley Youth F.C. U10
\t\t</td>
    <td>KETTS PARK COMMUNITY RECREATION CENTRE #8</td>
    <td>Under 10 Grace Clinton</td>
    <td></td>
  </tr>
  <tr>
    <td>16L2</td>
    <td>
\t\t\t\t06/09/26
\t\t\t\t00:00
\t\t</td>
    <td>
\t\t\tMorley Youth F.C. U16
\t\t</td>
    <td></td>
    <td>
\t\t\tVS
\t\t</td>
    <td></td>
    <td>
\t\t\tSheringham F.C. U16
\t\t</td>
    <td>MORLEY VILLAGE &amp; SPORTS HALL #1</td>
    <td>Under 16 League 2</td>
    <td></td>
  </tr>
</table>
</body></html>`;

// Old-season markup: classed table, space-separated inline text
const LEGACY_HTML = `
<html><body>
<table class="League-Results_Table">
  <tr>
    <td>13L1</td>
    <td>21/03/26 10:00</td>
    <td>Morley YFC U13 Stallions</td>
    <td> VS </td>
    <td>Wymondham Town U13</td>
    <td>MORLEY VILLAGE #1</td>
  </tr>
</table>
</body></html>`;

test('parses the 2026/27 classless tab-separated markup', () => {
  const fixtures = parseFixtures(NEW_SEASON_HTML, 'boys');
  assert.equal(fixtures.length, 2, 'both fixture rows parsed');

  const away = fixtures.find(f => f.away_team.includes('Morley Youth F.C. U10'));
  assert.ok(away, 'Morley U10 away fixture found');
  assert.equal(away.match_date, '2026-09-05');
  assert.equal(away.kick_off, '10:00');
  assert.equal(away.home_team, 'Wymondham Town United F.C. U10 (U9) Gree');
  assert.equal(away.is_home_game, false, 'Wymondham at home → not a Morley home game');

  const home = fixtures.find(f => f.home_team === 'Morley Youth F.C. U16');
  assert.ok(home, 'Morley U16 home fixture found');
  assert.equal(home.match_date, '2026-09-06');
  assert.equal(home.is_home_game, true, 'Morley at home');
  assert.equal(home.age_group, 'U16');
  assert.equal(home.format, '11v11');
});

test('still parses the legacy classed markup', () => {
  const fixtures = parseFixtures(LEGACY_HTML, 'boys');
  assert.equal(fixtures.length, 1);
  assert.equal(fixtures[0].home_team, 'Morley YFC U13 Stallions');
  assert.equal(fixtures[0].match_date, '2026-03-21');
  assert.equal(fixtures[0].is_home_game, true);
});

test('transient proxy errors are recognised for retry; slow timeouts are not', () => {
  const { isTransientNavError } = require('../services/scraper');
  assert.ok(isTransientNavError('net::ERR_TUNNEL_CONNECTION_FAILED at https://fulltime.thefa.com/...'));
  assert.ok(isTransientNavError('net::ERR_PROXY_CONNECTION_FAILED'));
  assert.ok(isTransientNavError('net::ERR_CONNECTION_RESET'));
  // FA blocking shows as a slow navigation timeout — retrying burns 90s per attempt
  assert.ok(!isTransientNavError('Navigation timeout of 90000 ms exceeded'));
  assert.ok(!isTransientNavError(''));
});

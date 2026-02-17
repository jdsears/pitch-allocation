#!/usr/bin/env node
/**
 * Local Fixture Scraper for Morley YFC
 *
 * Run this on your Mac to scrape fixtures from FA Full-Time and push
 * them to the Railway API. Railway can't reach fulltime.thefa.com
 * (blocked/firewalled), so this runs locally where the site is accessible.
 *
 * Usage:
 *   node scripts/scrape-local.js
 *   node scripts/scrape-local.js --dry-run     # parse only, don't push
 *   node scripts/scrape-local.js --boys-only
 *   node scripts/scrape-local.js --girls-only
 *
 * Prerequisites:
 *   npm install  (from pitch-agent directory - uses project's puppeteer + cheerio)
 *
 * The script will:
 *   1. Launch a headless browser on your Mac
 *   2. Scrape boys + girls fixtures from FA Full-Time
 *   3. POST them to the Railway API /api/fixtures/import endpoint
 */

const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

// ---- Configuration ----
const API_URL = process.env.API_URL || 'https://pitch-allocation-production.up.railway.app';

const BOYS_SEASON_ID = '353505162';
const BOYS_CLUB_ID = '926960945';
const GIRLS_SEASON_ID = '199649392';
const GIRLS_CLUB_ID = '468454775';

// Age group to pitch format (boys)
const AGE_TO_FORMAT = {
  'U6': '5v5', 'U7': '5v5', 'U8': '5v5',
  'U9': '7v7', 'U10': '7v7',
  'U11': '9v9', 'U12': '9v9',
  'U13': '11v11', 'U14': '11v11', 'U15': '11v11', 'U16': '11v11',
  'U17': '11v11', 'U18': '11v11'
};

// Girls play formats one year later (NWGFL rules):
// U9 stays 5v5, U11 stays 7v7, U13/U14 stay 9v9, 11v11 from U15
const GIRLS_AGE_TO_FORMAT = {
  ...AGE_TO_FORMAT,
  'U9': '5v5', 'U11': '7v7', 'U13': '9v9', 'U14': '9v9'
};

// ---- Helpers ----
function extractAgeGroup(teamName) {
  const match = teamName.match(/U(\d+)/i);
  return match ? `U${match[1]}` : null;
}

function getFormat(ageGroup, gender) {
  const map = gender === 'girls' ? GIRLS_AGE_TO_FORMAT : AGE_TO_FORMAT;
  return map[ageGroup] || '11v11';
}

function isMorleyHome(homeTeam) {
  return homeTeam.toLowerCase().includes('morley');
}

function buildFixtureUrl(seasonId, clubId) {
  return `https://fulltime.thefa.com/fixtures.html?selectedSeason=${seasonId}&selectedFixtureGroupAgeGroup=0&selectedFixtureGroupKey=&selectedDateCode=all&selectedClub=${clubId}&selectedTeam=&selectedRelatedFixtureOption=3&selectedFixtureDateStatus=&selectedFixtureStatus=&previousSelectedFixtureGroupAgeGroup=0&previousSelectedFixtureGroupKey=&previousSelectedClub=${clubId}&itemsPerPage=100`;
}

// ---- Scraping ----
async function scrapeFixturePage(url, label) {
  console.log(`\n--- Scraping ${label} ---`);
  console.log(`URL: ${url.substring(0, 80)}...`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Block heavy resources
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'font', 'media'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Navigate and wait for content
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('Page loaded, waiting for fixture table...');

    // Wait for table to appear
    const selectors = ['.League-Results_Table', 'table.table', 'table'];
    let found = false;
    for (const sel of selectors) {
      try {
        await page.waitForSelector(sel, { timeout: 15000 });
        console.log(`Found table: ${sel}`);
        found = true;
        break;
      } catch {
        // try next
      }
    }

    if (!found) {
      console.warn('No fixture table found on page.');
    }

    // Extra wait for JS rendering
    await new Promise(r => setTimeout(r, 3000));

    const html = await page.content();
    console.log(`Captured ${html.length} bytes of HTML`);

    return parseFixtures(html);
  } finally {
    await browser.close();
  }
}

function parseFixtures(html) {
  const $ = cheerio.load(html);
  const fixtures = [];

  // Try the known FA Full-Time table class first, then fall back
  let rows;
  if ($('.League-Results_Table tr').length > 0) {
    rows = $('.League-Results_Table tr');
    console.log(`Using .League-Results_Table: ${rows.length} rows`);
  } else {
    rows = $('tr').filter((i, row) => {
      const text = $(row).text();
      return text.includes(' VS ') || text.includes(' v ') || text.includes(' vs ');
    });
    console.log(`Using VS-filter fallback: ${rows.length} rows`);
  }

  rows.each((i, row) => {
    if ($(row).find('th').length > 0) return;

    const cells = $(row).find('td');
    if (cells.length < 4) return;

    const cellTexts = [];
    cells.each((j, cell) => {
      cellTexts.push($(cell).text().trim());
    });

    const rowText = cellTexts.join(' ');

    const dateMatch = rowText.match(/(\d{2}\/\d{2}\/\d{2,4})/);
    if (!dateMatch) return;

    const timeMatch = rowText.match(/(\d{2}:\d{2})/);

    // Find VS cell
    let vsCell = -1;
    cellTexts.forEach((text, idx) => {
      if (text.toUpperCase() === 'VS' || text.toUpperCase() === 'V') vsCell = idx;
    });
    if (vsCell === -1) return;

    // League code
    let leagueCode = '';
    if (cellTexts[0] && cellTexts[0].match(/^\d{2}[A-Z]/)) {
      leagueCode = cellTexts[0];
    }

    // Home team: scan backwards from VS
    let homeTeam = '';
    for (let k = vsCell - 1; k >= 0; k--) {
      const text = cellTexts[k];
      if (text.length > 3 && !text.match(/^\d{2}[\/:]/) && !text.match(/^\d{2}[A-Z]/) && text !== 'VS') {
        homeTeam = text;
        break;
      }
    }

    // Away team: scan forwards from VS
    let awayTeam = '';
    for (let k = vsCell + 1; k < cellTexts.length; k++) {
      const text = cellTexts[k];
      if (text.length > 3 && !text.match(/^\d{2}[\/:]/) && text !== 'VS') {
        awayTeam = text;
        break;
      }
    }

    if (!homeTeam || !awayTeam) return;

    // Venue: last meaningful cell
    let venueName = '';
    for (let k = cellTexts.length - 1; k > vsCell + 1; k--) {
      const text = cellTexts[k];
      if (text.length > 2 && text !== awayTeam && !text.match(/^\d{2}[\/:]/) && text.toUpperCase() !== 'VS') {
        venueName = text;
        break;
      }
    }

    // Parse date
    const dateParts = dateMatch[1].split('/');
    let year = dateParts[2];
    if (year.length === 2) year = '20' + year;
    const matchDate = `${year}-${dateParts[1]}-${dateParts[0]}`;

    const kickOff = timeMatch ? timeMatch[1] : null;
    const ageGroup = extractAgeGroup(homeTeam) || extractAgeGroup(awayTeam);
    const format = getFormat(ageGroup);

    fixtures.push({
      league_code: leagueCode,
      match_date: matchDate,
      kick_off: kickOff,
      home_team: homeTeam,
      away_team: awayTeam,
      venue_name: venueName,
      is_home_game: isMorleyHome(homeTeam),
      age_group: ageGroup,
      format,
      match_type: 'League / Cup'
    });
  });

  return fixtures;
}

// ---- Push to Railway API ----
async function pushFixtures(fixtures) {
  const url = `${API_URL}/api/fixtures/import`;
  console.log(`\nPushing ${fixtures.length} fixtures to ${url}...`);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fixtures })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text}`);
  }

  return response.json();
}

// ---- Main ----
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const boysOnly = args.includes('--boys-only');
  const girlsOnly = args.includes('--girls-only');

  console.log('=== Morley YFC Fixture Scraper (Local) ===');
  if (dryRun) console.log('DRY RUN - will not push to API');

  let allFixtures = [];

  if (!girlsOnly) {
    const boysUrl = buildFixtureUrl(BOYS_SEASON_ID, BOYS_CLUB_ID);
    const boys = await scrapeFixturePage(boysUrl, 'Boys');
    const boysTagged = boys.map(f => ({ ...f, gender: 'boys' }));
    console.log(`Boys fixtures found: ${boysTagged.length}`);
    allFixtures.push(...boysTagged);
  }

  if (!boysOnly) {
    const girlsUrl = buildFixtureUrl(GIRLS_SEASON_ID, GIRLS_CLUB_ID);
    const girls = await scrapeFixturePage(girlsUrl, 'Girls');
    // Re-map format for girls (U13/U14 play 9v9 not 11v11)
    const girlsTagged = girls.map(f => ({ ...f, gender: 'girls', format: getFormat(f.age_group, 'girls') }));
    console.log(`Girls fixtures found: ${girlsTagged.length}`);
    allFixtures.push(...girlsTagged);
  }

  console.log(`\n=== Total fixtures: ${allFixtures.length} ===`);

  if (allFixtures.length === 0) {
    console.log('No fixtures found. The page structure may have changed.');
    console.log('Try running with --dry-run and check the console output for clues.');
    process.exit(1);
  }

  // Print summary table
  console.log('\nFixtures:');
  console.log('-'.repeat(100));
  for (const f of allFixtures) {
    const home = f.is_home_game ? '(H)' : '(A)';
    console.log(`  ${f.match_date} ${f.kick_off || '??:??'}  ${f.home_team} vs ${f.away_team}  ${home}  ${f.age_group || '?'}  ${f.gender}`);
  }
  console.log('-'.repeat(100));

  if (dryRun) {
    console.log('\nDry run complete. Run without --dry-run to push to API.');
    return;
  }

  const result = await pushFixtures(allFixtures);
  console.log(`\nAPI response:`, result);
  console.log('Done!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const pool = require('../db/pool');

// Age group to pitch format mapping
const AGE_TO_FORMAT = {
  'U6': '5v5', 'U7': '5v5', 'U8': '5v5',
  'U9': '7v7', 'U10': '7v7',
  'U11': '9v9', 'U12': '9v9',
  'U13': '11v11', 'U14': '11v11', 'U15': '11v11', 'U16': '11v11',
  'U17': '11v11', 'U18': '11v11'
};

// Extract age group from team name like "Morley Youth F.C. U14 Stallions"
function extractAgeGroup(teamName) {
  const match = teamName.match(/U(\d+)/i);
  return match ? `U${match[1]}` : null;
}

// Determine format from age group
function getFormat(ageGroup) {
  return AGE_TO_FORMAT[ageGroup] || '11v11';
}

// Check if Morley is the home team
function isMorleyHome(homeTeam) {
  return homeTeam.toLowerCase().includes('morley');
}

// FA Full-Time club/season IDs. These are public (they appear in the
// fixtures URL and in the club's manual scrape tool) so they double as
// sensible defaults — override via env if a new season changes them.
const FA_TARGETS = {
  boys: {
    club: process.env.FA_BOYS_CLUB_ID || '926960945',
    season: process.env.FA_BOYS_SEASON_ID || '353505162',
  },
  girls: {
    club: process.env.FA_GIRLS_CLUB_ID || '468454775',
    season: process.env.FA_GIRLS_SEASON_ID || '199649392',
  },
};

// True if we have at least one club/season pair to scrape
function hasFaConfig() {
  return Object.values(FA_TARGETS).some(t => t.club && t.season);
}

// Build the FA Full-Time fixtures URL for a club/season (proven query string)
function buildFixturesUrl(clubId, seasonId) {
  return `https://fulltime.thefa.com/fixtures.html?selectedSeason=${seasonId}` +
    `&selectedFixtureGroupAgeGroup=0&selectedFixtureGroupKey=&selectedDateCode=all` +
    `&selectedClub=${clubId}&selectedTeam=&selectedRelatedFixtureOption=3` +
    `&selectedFixtureDateStatus=&selectedFixtureStatus=` +
    `&previousSelectedFixtureGroupAgeGroup=0&previousSelectedFixtureGroupKey=` +
    `&previousSelectedClub=${clubId}&itemsPerPage=100`;
}

// Scrape boys fixtures (filtered by club ID)
async function scrapeBoysFixtures() {
  const { club, season } = FA_TARGETS.boys;
  if (!club || !season) return [];
  const url = buildFixturesUrl(club, season);
  const fixtures = await scrapeFixturePage(url, 'Boys');
  return fixtures.map(f => ({ ...f, gender: 'boys' }));
}

// Scrape girls fixtures (filtered by club ID)
async function scrapeGirlsFixtures() {
  const { club, season } = FA_TARGETS.girls;
  if (!club || !season) return [];
  const url = buildFixturesUrl(club, season);
  const fixtures = await scrapeFixturePage(url, 'Girls');
  return fixtures.map(f => ({ ...f, gender: 'girls' }));
}

// Core scraping function using Puppeteer
async function scrapeFixturePage(url, label = 'fixtures') {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.NODE_ENV === 'production'
        ? '/usr/bin/chromium'
        : undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );

    // Block images / fonts / media — faster, lighter, and avoids timeouts
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      ['image', 'font', 'media'].includes(r.resourceType()) ? r.abort() : r.continue();
    });

    console.log(`Scraping ${label}: ${url.substring(0, 80)}...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // The fixtures table is rendered dynamically — give it a moment to settle
    await page
      .waitForSelector('.League-Results_Table, table, [class*=fixture], [class*=Fixture]', { timeout: 10000 })
      .catch(() => console.log(`  No fixture table selector matched for ${label}`));
    await new Promise((r) => setTimeout(r, 5000));

    const html = await page.content();
    console.log(`  ${label}: captured ${html.length} bytes`);

    const fixtures = parseFixtures(html, label);
    console.log(`  ${label}: parsed ${fixtures.length} fixtures`);
    return fixtures;
  } catch (err) {
    console.error(`Scraping error (${label}):`, err.message);
    return [];
  } finally {
    if (browser) await browser.close();
  }
}

// Parse fixtures out of the FA Full-Time HTML. Uses several fallback
// strategies because the table markup varies (this mirrors the club's
// proven manual scrape tool).
function parseFixtures(html, label = 'fixtures') {
  const $ = cheerio.load(html);
  const fixtures = [];

  // Strategy 1: the FA's results table class
  let rows;
  const lrtRows = $('.League-Results_Table tr');
  if (lrtRows.length > 0) {
    rows = lrtRows;
  } else {
    // Strategy 2: any table row that contains a "v / vs / VS" separator
    const vsRows = $('tr').filter((i, row) => {
      const t = $(row).text();
      return t.includes(' VS ') || t.includes(' v ') || t.includes(' vs ');
    });
    // Strategy 3: fall back to every table row
    rows = vsRows.length > 0 ? vsRows : $('tr');
  }

  if (!rows || rows.length === 0) return fixtures;

  rows.each((i, row) => {
    if ($(row).find('th').length > 0) return; // header row
    const cells = $(row).find('td');
    if (cells.length < 3) return;

    const cellTexts = [];
    cells.each((j, c) => cellTexts.push($(c).text().trim()));
    const rowText = cellTexts.join(' ');

    const dateMatch = rowText.match(/(\d{2}\/\d{2}\/\d{2,4})/);
    if (!dateMatch) return;
    const timeMatch = rowText.match(/(\d{2}:\d{2})/);

    const toDate = (raw) => {
      const dp = raw.split('/');
      let yr = dp[2];
      if (yr && yr.length === 2) yr = '20' + yr;
      return `${yr}-${dp[1]}-${dp[0]}`;
    };

    // Find a standalone VS cell
    let vsCell = -1;
    cellTexts.forEach((t, idx) => {
      const u = t.trim().toUpperCase();
      if (u === 'VS' || u === 'V' || u === 'VS.') vsCell = idx;
    });

    // Case A: "Home Team VS Away Team" packed into a single cell
    if (vsCell === -1) {
      for (const t of cellTexts) {
        const m = t.match(/(.{4,})\s+(?:VS|vs|v|V)\s+(.{4,})/);
        if (!m) continue;
        const homeTeam = m[1].trim();
        const awayTeam = m[2].trim();
        const ageGroup = extractAgeGroup(homeTeam) || extractAgeGroup(awayTeam);
        let venueName = '';
        for (let k = cellTexts.length - 1; k >= 0; k--) {
          const ct = cellTexts[k];
          if (ct.length > 2 && ct !== t && !ct.match(/^\d{2}[/:]/) && ct !== dateMatch[1]) {
            venueName = ct;
            break;
          }
        }
        fixtures.push({
          league_code: '',
          match_date: toDate(dateMatch[1]),
          kick_off: timeMatch ? timeMatch[1] : null,
          home_team: homeTeam,
          away_team: awayTeam,
          venue_name: venueName,
          is_home_game: isMorleyHome(homeTeam),
          age_group: ageGroup,
          format: getFormat(ageGroup),
          match_type: 'League / Cup',
        });
      }
      return;
    }

    // Case B: teams live in separate cells either side of the VS cell
    let leagueCode = '';
    if (cellTexts[0] && cellTexts[0].match(/^\d{2}[A-Z]/)) leagueCode = cellTexts[0];

    let homeTeam = '';
    for (let k = vsCell - 1; k >= 0; k--) {
      const t = cellTexts[k];
      if (t.length > 3 && !t.match(/^\d{2}[/:]/) && !t.match(/^\d{2}[A-Z]/) && t.toUpperCase() !== 'VS') {
        homeTeam = t;
        break;
      }
    }
    let awayTeam = '';
    for (let k = vsCell + 1; k < cellTexts.length; k++) {
      const t = cellTexts[k];
      if (t.length > 3 && !t.match(/^\d{2}[/:]/) && t.toUpperCase() !== 'VS') {
        awayTeam = t;
        break;
      }
    }
    if (!homeTeam || !awayTeam) return;

    let venueName = '';
    for (let k = cellTexts.length - 1; k > vsCell + 1; k--) {
      const t = cellTexts[k];
      if (t.length > 2 && t !== awayTeam && !t.match(/^\d{2}[/:]/) && t.toUpperCase() !== 'VS') {
        venueName = t;
        break;
      }
    }

    const ageGroup = extractAgeGroup(homeTeam) || extractAgeGroup(awayTeam);
    fixtures.push({
      league_code: leagueCode,
      match_date: toDate(dateMatch[1]),
      kick_off: timeMatch ? timeMatch[1] : null,
      home_team: homeTeam,
      away_team: awayTeam,
      venue_name: venueName,
      is_home_game: isMorleyHome(homeTeam),
      age_group: ageGroup,
      format: getFormat(ageGroup),
      match_type: 'League / Cup',
    });
  });

  return fixtures;
}

// Save fixtures to database
async function saveFixtures(fixtures) {
  const client = await pool.connect();
  let saved = 0;
  let skipped = 0;

  try {
    for (const f of fixtures) {
      try {
        await client.query(
          `INSERT INTO fixtures (league_code, match_date, kick_off, home_team, away_team, venue_name, match_type, is_home_game, gender, age_group, format)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (match_date, home_team, away_team) DO UPDATE SET
             kick_off = EXCLUDED.kick_off,
             venue_name = EXCLUDED.venue_name,
             league_code = EXCLUDED.league_code`,
          [f.league_code, f.match_date, f.kick_off, f.home_team, f.away_team, f.venue_name, f.match_type, f.is_home_game, f.gender, f.age_group, f.format]
        );
        saved++;
      } catch (err) {
        skipped++;
      }
    }
    console.log(`Saved ${saved} fixtures, skipped ${skipped}`);
  } finally {
    client.release();
  }

  return { saved, skipped };
}

// Main scrape function - runs both boys and girls
async function scrapeAll() {
  const boys = await scrapeBoysFixtures();
  const girls = await scrapeGirlsFixtures();
  const all = [...boys, ...girls];

  console.log(`Total fixtures found: ${all.length} (${boys.length} boys, ${girls.length} girls)`);

  const result = await saveFixtures(all);
  return { total: all.length, ...result };
}

// --- Scrape status + concurrency guard -------------------------------------
// Shared by the manual "Scrape now" button and the cron scheduler so the two
// can't trample each other, and the UI can show what last happened.
let status = {
  running: false,
  source: null,        // 'manual' | 'scheduled'
  lastRunAt: null,
  lastResult: null,    // { total, saved, skipped }
  lastError: null,
  lastDurationMs: null,
};

function getScrapeStatus() {
  return { ...status };
}

/**
 * Run a scrape with an overlap guard. If one is already in progress, the
 * caller gets `{ skipped: true }` instead of launching a second browser.
 */
async function runScrape(source = 'manual') {
  if (status.running) {
    return { skipped: true, reason: 'A scrape is already in progress', status: getScrapeStatus() };
  }

  status = { ...status, running: true, source, lastError: null };
  const startedAt = Date.now();

  try {
    const result = await scrapeAll();
    status = {
      ...status,
      running: false,
      lastRunAt: new Date().toISOString(),
      lastResult: result,
      lastError: null,
      lastDurationMs: Date.now() - startedAt,
    };
    return { ...result, status: getScrapeStatus() };
  } catch (err) {
    status = {
      ...status,
      running: false,
      lastRunAt: new Date().toISOString(),
      lastError: err.message,
      lastDurationMs: Date.now() - startedAt,
    };
    throw err;
  }
}

module.exports = {
  scrapeAll,
  runScrape,
  getScrapeStatus,
  hasFaConfig,
  parseFixtures,
  scrapeBoysFixtures,
  scrapeGirlsFixtures,
  saveFixtures,
};

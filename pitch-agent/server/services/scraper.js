const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs');
const pool = require('../db/pool');

// Find the system-installed Chromium binary
function findChromiumPath() {
  // Prefer env var set in Dockerfile
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const candidates = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Age group to pitch format mapping (boys)
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

/**
 * Parse SCRAPE_PROXY into a Chromium-compatible server string + optional creds.
 * FA Full-Time blocks cloud IPs, so the server-side scrape needs to egress
 * through a UK/residential proxy. Accepts:
 *   host:port
 *   http://host:port
 *   http://user:pass@host:port   (socks5://… also works)
 * Chromium's --proxy-server can't carry credentials, so we strip them here
 * and apply them per-page via page.authenticate().
 */
function parseProxy() {
  const raw = (process.env.SCRAPE_PROXY || '').trim();
  if (!raw) return null;
  const withScheme = raw.includes('://') ? raw : `http://${raw}`;
  try {
    const u = new URL(withScheme);
    const server = `${u.protocol}//${u.host}`; // host includes port
    const username = u.username ? decodeURIComponent(u.username) : null;
    const password = u.password ? decodeURIComponent(u.password) : null;
    return { server, username, password };
  } catch (e) {
    console.warn(`Ignoring malformed SCRAPE_PROXY: ${e.message}`);
    return null;
  }
}

// Apply proxy credentials to a page if the proxy needs auth (no-op otherwise)
async function applyProxyAuth(page) {
  const proxy = parseProxy();
  if (proxy && proxy.username) {
    await page.authenticate({ username: proxy.username, password: proxy.password || '' });
  }
}

// Launch a Puppeteer browser with Railway-compatible settings
async function launchBrowser() {
  const launchOptions = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
    ]
  };

  const proxy = parseProxy();
  if (proxy) {
    launchOptions.args.push(`--proxy-server=${proxy.server}`);
    // Log host only — never the credentials
    console.log(`Scrape proxy enabled: ${proxy.server}${proxy.username ? ' (authenticated)' : ''}`);
  }

  if (process.env.NODE_ENV === 'production') {
    const chromiumPath = findChromiumPath();
    if (chromiumPath) {
      launchOptions.executablePath = chromiumPath;
      console.log(`Using Chromium at: ${chromiumPath}`);
    } else {
      console.warn('No system Chromium found, falling back to Puppeteer bundled Chromium');
    }
  }

  return puppeteer.launch(launchOptions);
}

// Fetch the fully-rendered HTML from a URL using Puppeteer
async function fetchRenderedHTML(url) {
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await applyProxyAuth(page);
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Block unnecessary resources to speed up loading
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'font', 'media'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    console.log(`Navigating to: ${url}`);

    // FA Full-Time does client-side redirects after initial load.
    // Use 'load' event which waits for initial page + subresources,
    // then wait for any subsequent navigation to settle.
    await page.goto(url, { waitUntil: 'load', timeout: 90000 });
    console.log(`Page loaded. Current URL: ${page.url()}`);

    // Wait for any client-side redirect to complete
    try {
      await page.waitForNavigation({ waitUntil: 'load', timeout: 15000 });
      console.log(`Redirected to: ${page.url()}`);
    } catch {
      // No redirect happened within 15s - that's fine
      console.log('No redirect detected, continuing...');
    }

    // Now wait for the actual fixture table to appear (JS-rendered content)
    const selectors = ['.League-Results_Table', 'table.table', 'table'];
    let found = false;
    for (const sel of selectors) {
      try {
        await page.waitForSelector(sel, { timeout: 30000 });
        console.log(`Found table with selector: ${sel}`);
        found = true;
        break;
      } catch {
        console.log(`Selector "${sel}" not found, trying next...`);
      }
    }

    if (!found) {
      console.warn('No fixture table selector matched. Capturing page anyway for diagnostics.');
    }

    // Extra wait for JS to populate the table rows
    await new Promise(r => setTimeout(r, 5000));

    const html = await page.content();
    console.log(`Captured HTML: ${html.length} bytes. Final URL: ${page.url()}`);
    return html;
  } finally {
    if (browser) await browser.close();
  }
}

// Parse fixtures from the rendered HTML
function parseFixtures(html, gender = 'boys') {
  const $ = cheerio.load(html);
  const fixtures = [];

  // Try the known FA Full-Time table class first, then fall back
  let rows;
  if ($('.League-Results_Table tr').length > 0) {
    rows = $('.League-Results_Table tr');
    console.log(`Using .League-Results_Table selector, found ${rows.length} rows`);
  } else {
    // Fallback: find any table that contains "VS" text
    rows = $('tr').filter((i, row) => {
      const text = $(row).text();
      return text.includes(' VS ') || text.includes(' v ') || text.includes(' vs ');
    });
    console.log(`Using fallback VS-filter, found ${rows.length} rows`);
  }

  rows.each((i, row) => {
    // Skip header rows
    if ($(row).find('th').length > 0) return;

    const cells = $(row).find('td');
    if (cells.length < 4) return;

    // Collect all cell texts
    const cellTexts = [];
    cells.each((j, cell) => {
      cellTexts.push($(cell).text().trim());
    });

    const rowText = cellTexts.join(' ');

    // Must contain a date pattern
    const dateMatch = rowText.match(/(\d{2}\/\d{2}\/\d{2,4})/);
    if (!dateMatch) return;

    const timeMatch = rowText.match(/(\d{2}:\d{2})/);

    // Find the VS cell
    let vsCell = -1;
    cellTexts.forEach((text, idx) => {
      if (text.toUpperCase() === 'VS' || text.toUpperCase() === 'V') vsCell = idx;
    });

    if (vsCell === -1) return;

    // Extract league code from first cell
    let leagueCode = '';
    if (cellTexts[0] && cellTexts[0].match(/^\d{2}[A-Z]/)) {
      leagueCode = cellTexts[0];
    }

    // Home team: scan backwards from VS, find first cell with meaningful text
    let homeTeam = '';
    for (let k = vsCell - 1; k >= 0; k--) {
      const text = cellTexts[k];
      // Skip empty cells, cells that are just images/logos, very short text, dates, times
      if (text.length > 3 && !text.match(/^\d{2}[\/:]/) && !text.match(/^\d{2}[A-Z]/) && text !== 'VS') {
        homeTeam = text;
        break;
      }
    }

    // Away team: scan forwards from VS, find first cell with meaningful text
    let awayTeam = '';
    for (let k = vsCell + 1; k < cellTexts.length; k++) {
      const text = cellTexts[k];
      if (text.length > 3 && !text.match(/^\d{2}[\/:]/) && text !== 'VS') {
        awayTeam = text;
        break;
      }
    }

    if (!homeTeam || !awayTeam) return;

    // Venue: usually the last meaningful cell after the away team
    let venueName = '';
    // Start from the end, skip empty cells
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
    const format = getFormat(ageGroup, gender);

    fixtures.push({
      league_code: leagueCode,
      match_date: matchDate,
      kick_off: kickOff,
      home_team: homeTeam,
      away_team: awayTeam,
      venue_name: venueName,
      is_home_game: isMorleyHome(homeTeam),
      age_group: ageGroup,
      format: format,
      gender: gender,
      match_type: 'League / Cup'
    });
  });

  return fixtures;
}

// Build the FA Full-Time URL for a club
function buildFixtureUrl(seasonId, clubId) {
  return `https://fulltime.thefa.com/fixtures.html?selectedSeason=${seasonId}&selectedFixtureGroupAgeGroup=0&selectedFixtureGroupKey=&selectedDateCode=all&selectedClub=${clubId}&selectedTeam=&selectedRelatedFixtureOption=3&selectedFixtureDateStatus=&selectedFixtureStatus=&previousSelectedFixtureGroupAgeGroup=0&previousSelectedFixtureGroupKey=&previousSelectedClub=${clubId}&itemsPerPage=100`;
}

async function scrapeBoysFixtures() {
  const url = buildFixtureUrl(process.env.FA_BOYS_SEASON_ID, process.env.FA_BOYS_CLUB_ID);
  console.log('Scraping boys fixtures...');
  const html = await fetchRenderedHTML(url);
  const fixtures = parseFixtures(html, 'boys');
  console.log(`Boys: found ${fixtures.length} fixtures`);
  return fixtures;
}

async function scrapeGirlsFixtures() {
  const url = buildFixtureUrl(process.env.FA_GIRLS_SEASON_ID, process.env.FA_GIRLS_CLUB_ID);
  console.log('Scraping girls fixtures...');
  const html = await fetchRenderedHTML(url);
  const fixtures = parseFixtures(html, 'girls');
  console.log(`Girls: found ${fixtures.length} fixtures`);
  return fixtures;
}

// Debug function: returns raw HTML and parsing diagnostics
// Captures as much info as possible even if the page partially loads
async function debugScrape(gender) {
  const url = gender === 'girls'
    ? buildFixtureUrl(process.env.FA_GIRLS_SEASON_ID, process.env.FA_GIRLS_CLUB_ID)
    : buildFixtureUrl(process.env.FA_BOYS_SEASON_ID, process.env.FA_BOYS_CLUB_ID);

  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await applyProxyAuth(page);
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Block images/fonts to speed things up
    await page.setRequestInterception(true);
    const requestLog = [];
    page.on('request', (req) => {
      const type = req.resourceType();
      requestLog.push({ url: req.url().substring(0, 100), type });
      if (['image', 'font', 'media'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    let navigationError = null;
    let finalUrl = url;
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 90000 });
      finalUrl = page.url();
      console.log(`Debug: page loaded. URL: ${finalUrl}`);

      // Wait for any client-side redirect
      try {
        await page.waitForNavigation({ waitUntil: 'load', timeout: 15000 });
        finalUrl = page.url();
        console.log(`Debug: redirected to ${finalUrl}`);
      } catch {
        console.log('Debug: no redirect detected');
      }

      // Wait for JS content to render
      await new Promise(r => setTimeout(r, 5000));
    } catch (err) {
      navigationError = err.message;
      console.log(`Navigation issue: ${err.message}. Capturing whatever loaded.`);
    }

    // Use CDP to get HTML safely even if execution context was destroyed
    let html;
    try {
      html = await page.content();
    } catch {
      // Fallback: get HTML via CDP protocol directly
      const cdp = await page.target().createCDPSession();
      const { root } = await cdp.send('DOM.getDocument');
      const { outerHTML } = await cdp.send('DOM.getOuterHTML', { nodeId: root.nodeId });
      html = outerHTML;
    }
    const $ = cheerio.load(html);

    // Collect diagnostic info
    const tables = [];
    $('table').each((i, table) => {
      const classes = $(table).attr('class') || '(no class)';
      const id = $(table).attr('id') || '(no id)';
      const rowCount = $(table).find('tr').length;
      tables.push({ index: i, classes, id, rowCount });
    });

    // Sample first 5 rows with VS
    const sampleRows = [];
    $('tr').each((i, row) => {
      if (sampleRows.length >= 5) return;
      const text = $(row).text().trim();
      if (text.includes('VS') || text.includes(' v ')) {
        const cells = [];
        $(row).find('td').each((j, cell) => {
          cells.push($(cell).text().trim());
        });
        sampleRows.push({ rowIndex: i, cells, fullText: text.substring(0, 300) });
      }
    });

    // Also sample first 5 table rows (even without VS) for diagnostics
    const allSampleRows = [];
    $('tr').each((i, row) => {
      if (allSampleRows.length >= 5) return;
      const cells = [];
      $(row).find('td, th').each((j, cell) => {
        cells.push($(cell).text().trim());
      });
      if (cells.length > 0) {
        allSampleRows.push({ rowIndex: i, cells });
      }
    });

    const fixtures = parseFixtures(html, gender);

    // Grab a snippet of the raw HTML body for inspection
    const bodyHtml = $('body').html() || '';

    return {
      url,
      finalUrl,
      navigationError,
      htmlLength: html.length,
      title: $('title').text(),
      bodySnippet: bodyHtml.substring(0, 2000),
      tables,
      sampleRows,
      allSampleRows,
      networkRequests: requestLog.length,
      parsedFixtures: fixtures.length,
      firstFixtures: fixtures.slice(0, 3),
    };
  } finally {
    if (browser) await browser.close();
  }
}

// Save fixtures to database
async function saveFixtures(fixtures) {
  const client = await pool.connect();
  let saved = 0;
  let skipped = 0;

  let rescheduled = 0;
  try {
    for (const f of fixtures) {
      // Always recompute format from gender + age_group as a safety net
      const correctFormat = getFormat(f.age_group, f.gender);
      try {
        // If the fixture has a league_code, check for a rescheduled match
        // (same league_code + home_team but different date)
        if (f.league_code) {
          const existing = await client.query(
            `SELECT id, match_date FROM fixtures
             WHERE league_code = $1 AND home_team = $2 AND match_date != $3`,
            [f.league_code, f.home_team, f.match_date]
          );
          if (existing.rows.length > 0) {
            console.log(`Rescheduled: ${f.home_team} vs ${f.away_team} moved from ${existing.rows[0].match_date} to ${f.match_date}`);
            await client.query(
              `UPDATE fixtures SET match_date = $1, kick_off = $2, venue_name = $3,
               gender = $4, age_group = $5,
               format = CASE WHEN format_override = true THEN format ELSE $6 END
               WHERE id = $7`,
              [f.match_date, f.kick_off, f.venue_name, f.gender, f.age_group, correctFormat, existing.rows[0].id]
            );
            rescheduled++;
            saved++;
            continue;
          }
        }
        await client.query(
          `INSERT INTO fixtures (league_code, match_date, kick_off, home_team, away_team, venue_name, match_type, is_home_game, gender, age_group, format)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (match_date, home_team, away_team) DO UPDATE SET
             kick_off = EXCLUDED.kick_off,
             venue_name = EXCLUDED.venue_name,
             league_code = EXCLUDED.league_code,
             gender = EXCLUDED.gender,
             age_group = EXCLUDED.age_group,
             format = CASE WHEN fixtures.format_override = true THEN fixtures.format ELSE EXCLUDED.format END`,
          [f.league_code, f.match_date, f.kick_off, f.home_team, f.away_team, f.venue_name, f.match_type, f.is_home_game, f.gender, f.age_group, correctFormat]
        );
        saved++;
      } catch (err) {
        skipped++;
      }
    }
    console.log(`Saved ${saved} fixtures (${rescheduled} rescheduled), skipped ${skipped}`);
  } finally {
    client.release();
  }

  return { saved, skipped, rescheduled };
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

// The `running` guard lives in memory (single process); run history is
// persisted to the scrape_runs table so status survives restarts/redeploys.
const scrapeState = {
  running: false,
  runningSince: null,
  lastRunAt: null,
  lastResult: null,
  lastError: null,
  lastSource: null,
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// If a run has held the lock longer than this, assume it hung (puppeteer can
// stall indefinitely when FA blocks the host) and let a new run take over.
// Without this, one stuck scrape blocks every future run until a redeploy.
const STALE_RUN_MS = (parseInt(process.env.SCRAPE_STALE_MINUTES, 10) || 10) * 60 * 1000;

/**
 * Run a scrape, recording status and preventing overlapping runs.
 * @param {string} source - 'manual' or 'scheduled', for logging/visibility.
 * @param {object} opts - { attempts, retryDelayMs }: the scheduled run
 *   retries (FA Full-Time is flaky); manual runs default to one attempt
 *   since the user is watching and can click again.
 * @returns the scrape result, or { skipped: true } if one is already running.
 */
async function runScrape(source = 'manual', { attempts = 1, retryDelayMs = 60000 } = {}) {
  if (scrapeState.running) {
    const heldFor = Date.now() - (scrapeState.runningSince || 0);
    if (heldFor < STALE_RUN_MS) {
      console.log(`Scrape (${source}) skipped — another run is already in progress (${Math.round(heldFor / 1000)}s)`);
      return { skipped: true, reason: 'already running', runningSince: scrapeState.runningSince };
    }
    console.warn(`Scrape (${source}): previous run has held the lock ${Math.round(heldFor / 60000)}min — assuming it hung, taking over`);
  }
  scrapeState.running = true;
  scrapeState.runningSince = new Date().toISOString();
  scrapeState.lastSource = source;

  // Open a run row up front so even a crash mid-scrape leaves a trace
  let runId = null;
  try {
    const ins = await pool.query(`INSERT INTO scrape_runs (source) VALUES ($1) RETURNING id`, [source]);
    runId = ins.rows[0].id;
  } catch (e) {
    // DB unavailable — fall back to in-memory status only
  }

  try {
    let lastErr = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const result = await scrapeAll();
        scrapeState.lastResult = result;
        scrapeState.lastError = null;
        scrapeState.lastRunAt = new Date().toISOString();
        if (runId) {
          await pool.query(
            `UPDATE scrape_runs SET finished_at = NOW(), total = $1, saved = $2, rescheduled = $3, error = NULL WHERE id = $4`,
            [result.total ?? null, result.saved ?? null, result.rescheduled ?? null, runId]
          ).catch(() => {});
        }
        return result;
      } catch (err) {
        lastErr = err;
        if (attempt < attempts) {
          console.warn(`Scrape (${source}) attempt ${attempt}/${attempts} failed: ${err.message} — retrying in ${Math.round(retryDelayMs / 1000)}s`);
          await sleep(retryDelayMs);
        }
      }
    }
    scrapeState.lastError = lastErr.message;
    scrapeState.lastRunAt = new Date().toISOString();
    if (runId) {
      await pool.query(
        `UPDATE scrape_runs SET finished_at = NOW(), error = $1 WHERE id = $2`,
        [lastErr.message, runId]
      ).catch(() => {});
    }
    throw lastErr;
  } finally {
    scrapeState.running = false;
    scrapeState.runningSince = null;
  }
}

/** Latest run from the DB (survives restarts), falling back to memory. */
async function getScrapeStatus() {
  try {
    const r = await pool.query(`SELECT * FROM scrape_runs ORDER BY id DESC LIMIT 1`);
    if (r.rows.length > 0) {
      const row = r.rows[0];
      return {
        running: scrapeState.running,
        runningSince: scrapeState.runningSince,
        lastRunAt: row.finished_at || row.started_at,
        lastResult: row.error || row.finished_at === null
          ? null
          : { total: row.total, saved: row.saved, rescheduled: row.rescheduled },
        lastError: row.error,
        lastSource: row.source,
      };
    }
  } catch (e) {
    // table missing / DB down — in-memory state is better than a 500
  }
  return { ...scrapeState };
}

module.exports = { scrapeAll, runScrape, getScrapeStatus, scrapeBoysFixtures, scrapeGirlsFixtures, saveFixtures, debugScrape, parseProxy };

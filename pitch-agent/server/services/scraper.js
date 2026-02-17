const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs');
const pool = require('../db/pool');

// Find the system-installed Chromium binary
function findChromiumPath() {
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

// Scrape boys fixtures (filtered by club ID)
async function scrapeBoysFixtures() {
  const clubId = process.env.FA_BOYS_CLUB_ID;
  const seasonId = process.env.FA_BOYS_SEASON_ID;
  
  const url = `https://fulltime.thefa.com/fixtures.html?selectedSeason=${seasonId}&selectedFixtureGroupAgeGroup=0&selectedFixtureGroupKey=&selectedDateCode=all&selectedClub=${clubId}&selectedTeam=&selectedRelatedFixtureOption=3&selectedFixtureDateStatus=&selectedFixtureStatus=&previousSelectedFixtureGroupAgeGroup=0&previousSelectedFixtureGroupKey=&previousSelectedClub=${clubId}&itemsPerPage=100`;

  console.log('Scraping boys fixtures...');
  const fixtures = await scrapeFixturePage(url);
  
  return fixtures.map(f => ({ ...f, gender: 'boys' }));
}

// Scrape girls fixtures (now also filtered by club ID)
async function scrapeGirlsFixtures() {
  const clubId = process.env.FA_GIRLS_CLUB_ID;
  const seasonId = process.env.FA_GIRLS_SEASON_ID;
  
  const url = `https://fulltime.thefa.com/fixtures.html?selectedSeason=${seasonId}&selectedFixtureGroupAgeGroup=0&selectedFixtureGroupKey=&selectedDateCode=all&selectedClub=${clubId}&selectedTeam=&selectedRelatedFixtureOption=3&selectedFixtureDateStatus=&selectedFixtureStatus=&previousSelectedFixtureGroupAgeGroup=&previousSelectedFixtureGroupKey=&previousSelectedClub=&itemsPerPage=100`;

  console.log('Scraping girls fixtures...');
  const fixtures = await scrapeFixturePage(url);
  
  return fixtures.map(f => ({ ...f, gender: 'girls' }));
}

// Core scraping function using Puppeteer
async function scrapeFixturePage(url) {
  let browser;
  try {
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

    if (process.env.NODE_ENV === 'production') {
      const chromiumPath = findChromiumPath();
      if (chromiumPath) {
        launchOptions.executablePath = chromiumPath;
        console.log(`Using Chromium at: ${chromiumPath}`);
      } else {
        console.warn('No system Chromium found, falling back to Puppeteer bundled Chromium');
      }
    }

    browser = await puppeteer.launch(launchOptions);
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait for the fixture table to load
    await page.waitForSelector('table, .fixtures-table, .results-table', { timeout: 10000 }).catch(() => {
      console.log('No fixture table found, trying alternative selectors...');
    });

    const html = await page.content();
    const $ = cheerio.load(html);
    
    const fixtures = [];

    // Parse fixture rows - FA Full-Time uses table rows with fixture data
    // Based on the screenshot structure: league code | date/time | home team | VS | away team | venue
    $('tr, .fixture-row').each((i, row) => {
      const cells = $(row).find('td, .cell');
      if (cells.length < 4) return;

      // Try to extract fixture data from the row
      const rowText = $(row).text().trim();
      
      // Look for date patterns (DD/MM/YY or DD/MM/YYYY)
      const dateMatch = rowText.match(/(\d{2}\/\d{2}\/\d{2,4})/);
      const timeMatch = rowText.match(/(\d{2}:\d{2})/);
      
      if (!dateMatch) return;

      // Extract team names - look for "VS" or "v" separator
      let homeTeam = '';
      let awayTeam = '';
      let leagueCode = '';
      let venueName = '';

      cells.each((j, cell) => {
        const text = $(cell).text().trim();
        
        // First cell is usually the league code
        if (j === 0 && text.match(/^\d{2}[A-Z]/)) {
          leagueCode = text;
        }
      });

      // Try to find team names around the VS separator
      const vsIndex = rowText.indexOf(' VS ') !== -1 ? rowText.indexOf(' VS ') : rowText.indexOf(' v ');
      
      if (vsIndex === -1) return;

      // Parse the cells more carefully
      const cellTexts = [];
      cells.each((j, cell) => {
        cellTexts.push($(cell).text().trim());
      });

      // Typical structure from FA Full-Time:
      // [league_code, date_time, home_team, (logo), VS, (logo), away_team, venue]
      // But logos may or may not be in separate cells
      
      // Find the cell containing "VS" or "v"
      let vsCell = -1;
      cellTexts.forEach((text, idx) => {
        if (text === 'VS' || text === 'v' || text === 'vs') vsCell = idx;
      });

      if (vsCell > 0) {
        // Home team is typically 1-2 cells before VS
        // Away team is typically 1-2 cells after VS
        for (let k = vsCell - 1; k >= 0; k--) {
          if (cellTexts[k].length > 3 && !cellTexts[k].match(/^\d/) && cellTexts[k] !== 'VS') {
            homeTeam = cellTexts[k];
            break;
          }
        }
        for (let k = vsCell + 1; k < cellTexts.length; k++) {
          if (cellTexts[k].length > 3 && !cellTexts[k].match(/^\d/) && cellTexts[k] !== 'VS') {
            awayTeam = cellTexts[k];
            break;
          }
        }
        // Venue is usually the last meaningful cell
        if (cellTexts.length > vsCell + 3) {
          venueName = cellTexts[cellTexts.length - 1];
        }
      }

      if (!homeTeam || !awayTeam) return;

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
        format: format,
        match_type: 'League / Cup'
      });
    });

    console.log(`Found ${fixtures.length} fixtures`);
    return fixtures;

  } catch (err) {
    console.error('Scraping error:', err.message);
    return [];
  } finally {
    if (browser) await browser.close();
  }
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

module.exports = { scrapeAll, scrapeBoysFixtures, scrapeGirlsFixtures, saveFixtures };

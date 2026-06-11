const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { runScrape, getScrapeStatus } = require('../services/scraper');

// GET /api/fixtures - list fixtures with optional filters
router.get('/', async (req, res) => {
  try {
    const { gender, dateFrom, dateTo, homeOnly } = req.query;
    let query = 'SELECT * FROM fixtures WHERE 1=1';
    const params = [];
    let idx = 1;

    if (gender) {
      query += ` AND gender = $${idx++}`;
      params.push(gender);
    }
    if (dateFrom) {
      query += ` AND match_date >= $${idx++}`;
      params.push(dateFrom);
    }
    if (dateTo) {
      query += ` AND match_date <= $${idx++}`;
      params.push(dateTo);
    }
    if (homeOnly === 'true') {
      query += ' AND is_home_game = true';
    }

    query += ' ORDER BY match_date, kick_off';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/fixtures/scrape - trigger fixture scraping (manual)
router.post('/scrape', async (req, res) => {
  try {
    console.log('Scrape triggered (manual)');
    const result = await runScrape('manual');
    if (result.skipped) {
      return res.status(409).json({ success: false, ...result });
    }
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message, status: getScrapeStatus() });
  }
});

// GET /api/fixtures/scrape/status - last run, in-progress flag, errors
router.get('/scrape/status', (req, res) => {
  res.json(getScrapeStatus());
});

// POST /api/fixtures/import - manually import fixtures (for when scraper can't reach FA)
router.post('/import', async (req, res) => {
  try {
    const { fixtures } = req.body;
    if (!fixtures || !Array.isArray(fixtures)) {
      return res.status(400).json({ error: 'fixtures array required' });
    }

    let saved = 0;
    for (const f of fixtures) {
      try {
        await pool.query(
          `INSERT INTO fixtures (league_code, match_date, kick_off, home_team, away_team, venue_name, match_type, is_home_game, gender, age_group, format)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (match_date, home_team, away_team) DO UPDATE SET
             kick_off = EXCLUDED.kick_off, venue_name = EXCLUDED.venue_name`,
          [f.league_code, f.match_date, f.kick_off, f.home_team, f.away_team, f.venue_name, f.match_type || 'League / Cup', f.is_home_game ?? true, f.gender || 'boys', f.age_group, f.format]
        );
        saved++;
      } catch (e) { /* skip dupes */ }
    }
    res.json({ success: true, saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

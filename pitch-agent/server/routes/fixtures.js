const express = require('express');
const router = express.Router();
const multer = require('multer');
const pool = require('../db/pool');
const { scrapeAll, debugScrape } = require('../services/scraper');
const { generateMacScript, generateWindowsScript } = require('../services/scrapeScriptGenerator');
const { parseFixturesFromImage } = require('../services/ocrFixtureParser');

// Multer config: accept images up to 10MB in memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

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

// POST /api/fixtures/scrape - trigger fixture scraping
router.post('/scrape', async (req, res) => {
  try {
    console.log('Scrape triggered');
    const result = await scrapeAll();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

// GET /api/fixtures/debug - debug scraping (shows raw HTML diagnostics)
router.get('/debug', async (req, res) => {
  try {
    const gender = req.query.gender || 'boys';
    const result = await debugScrape(gender);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// GET /api/fixtures/scrape-script - download a one-click scrape script
router.get('/scrape-script', (req, res) => {
  const platform = req.query.platform || 'mac';
  // Railway terminates TLS at its proxy, so req.protocol is 'http' even for HTTPS
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const apiUrl = `${proto}://${req.get('host')}`;

  if (platform === 'windows') {
    const script = generateWindowsScript(apiUrl);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="morley-scrape.ps1"');
    res.send(script);
  } else {
    const script = generateMacScript(apiUrl);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="morley-scrape.command"');
    res.send(script);
  }
});

// POST /api/fixtures/import-image - extract fixtures from a screenshot using OCR
router.post('/import-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    const gender = req.body.gender || 'boys';
    const fixtures = await parseFixturesFromImage(req.file.buffer, req.file.mimetype, gender);

    if (fixtures.length === 0) {
      return res.json({ success: true, fixtures: [], saved: 0, message: 'No fixtures found in image' });
    }

    // Save to database
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

    res.json({ success: true, fixtures, saved });
  } catch (err) {
    console.error('OCR import error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

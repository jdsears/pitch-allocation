const express = require('express');
const router = express.Router();
const multer = require('multer');
const pool = require('../db/pool');
const { runScrape, getScrapeStatus, debugScrape } = require('../services/scraper');
const { generateMacScript, generateWindowsScript } = require('../services/scrapeScriptGenerator');
const { parseFixturesFromImage } = require('../services/ocrFixtureParser');

// Canonical format mapping — single source of truth for server-side validation
const AGE_TO_FORMAT = {
  U6: '5v5', U7: '5v5', U8: '5v5', U9: '7v7', U10: '7v7',
  U11: '9v9', U12: '9v9', U13: '11v11', U14: '11v11', U15: '11v11',
  U16: '11v11', U17: '11v11', U18: '11v11'
};
const GIRLS_AGE_TO_FORMAT = {
  ...AGE_TO_FORMAT, U9: '5v5', U11: '7v7', U13: '9v9', U14: '9v9'
};
function computeFormat(ageGroup, gender) {
  const map = gender === 'girls' ? GIRLS_AGE_TO_FORMAT : AGE_TO_FORMAT;
  return map[ageGroup] || '11v11';
}

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

// GET /api/fixtures/teams - distinct home team names for filter dropdown
router.get('/teams', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT home_team FROM fixtures
       WHERE is_home_game = true
       ORDER BY home_team`
    );
    res.json(result.rows.map(r => r.home_team));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/fixtures/:id - update fixture fields (format, age_group, kick_off, etc)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { format, age_group, gender, kick_off } = req.body;

    const fields = [];
    const params = [];
    let idx = 1;

    if (format !== undefined) {
      fields.push(`format = $${idx++}`); params.push(format);
      // Mark as manually overridden so the allocator respects this format
      fields.push(`format_override = $${idx++}`); params.push(true);
    }
    if (age_group !== undefined) { fields.push(`age_group = $${idx++}`); params.push(age_group); }
    if (gender !== undefined) { fields.push(`gender = $${idx++}`); params.push(gender); }
    if (kick_off !== undefined) { fields.push(`kick_off = $${idx++}`); params.push(kick_off); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(id);
    const result = await pool.query(
      `UPDATE fixtures SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Fixture not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/fixtures/:id - delete fixture and cascade to allocations + referee claims
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // Cascade: delete referee claims → allocations → fixture
    await pool.query(
      `DELETE FROM referee_claims WHERE allocation_id IN (SELECT id FROM allocations WHERE fixture_id = $1)`,
      [id]
    );
    await pool.query('DELETE FROM allocations WHERE fixture_id = $1', [id]);
    const result = await pool.query('DELETE FROM fixtures WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Fixture not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

// POST /api/fixtures/scrape - trigger fixture scraping manually
router.post('/scrape', async (req, res) => {
  try {
    console.log('Scrape triggered (manual)');
    const result = await runScrape('manual');
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/fixtures/scrape-status - last scrape result + schedule info
router.get('/scrape-status', (req, res) => {
  res.json(getScrapeStatus());
});

// POST /api/fixtures/import - manually import fixtures (for when scraper can't reach FA)
// When sync=true, removes fixtures that are no longer on FA Full-Time (e.g. postponed)
router.post('/import', async (req, res) => {
  try {
    const { fixtures, sync } = req.body;
    if (!fixtures || !Array.isArray(fixtures)) {
      return res.status(400).json({ error: 'fixtures array required' });
    }

    // When sync=true, delete fixtures for imported genders that aren't in the new set.
    // This removes postponed fixtures that no longer appear on FA Full-Time.
    let removed = 0;
    if (sync && fixtures.length > 0) {
      const genders = [...new Set(fixtures.map(f => f.gender || 'boys'))];
      for (const gender of genders) {
        const genderFixtures = fixtures.filter(f => (f.gender || 'boys') === gender);
        // Build a set of (match_date, home_team, away_team) tuples to keep
        const keepTuples = genderFixtures.map(f => [f.match_date, f.home_team, f.away_team]);
        // Delete fixtures for this gender that aren't in the incoming set
        // Use a CTE with VALUES list for the comparison
        if (keepTuples.length > 0) {
          const placeholders = keepTuples.map((_, i) =>
            `($${i * 3 + 2}::date, $${i * 3 + 3}::varchar, $${i * 3 + 4}::varchar)`
          ).join(', ');
          const params = [gender];
          keepTuples.forEach(t => params.push(t[0], t[1], t[2]));
          const deleteResult = await pool.query(
            `DELETE FROM fixtures
             WHERE gender = $1
             AND (match_date, home_team, away_team) NOT IN (${placeholders})`,
            params
          );
          removed += deleteResult.rowCount;
        }
      }
    }

    let saved = 0;
    let rescheduled = 0;
    for (const f of fixtures) {
      // Always recompute format server-side from gender + age_group
      const gender = f.gender || 'boys';
      const format = computeFormat(f.age_group, gender);
      try {
        // If the fixture has a league_code, check for a rescheduled match
        // (same league_code + home_team but different date)
        if (f.league_code) {
          const existing = await pool.query(
            `SELECT id, match_date FROM fixtures
             WHERE league_code = $1 AND home_team = $2 AND match_date != $3`,
            [f.league_code, f.home_team, f.match_date]
          );
          if (existing.rows.length > 0) {
            // Rescheduled match — update existing fixture's date instead of creating duplicate
            await pool.query(
              `UPDATE fixtures SET match_date = $1, kick_off = $2, venue_name = $3,
               gender = $4, age_group = $5,
               format = CASE WHEN format_override = true THEN format ELSE $6 END
               WHERE id = $7`,
              [f.match_date, f.kick_off, f.venue_name, gender, f.age_group, format, existing.rows[0].id]
            );
            rescheduled++;
            saved++;
            continue;
          }
        }
        await pool.query(
          `INSERT INTO fixtures (league_code, match_date, kick_off, home_team, away_team, venue_name, match_type, is_home_game, gender, age_group, format)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (match_date, home_team, away_team) DO UPDATE SET
             kick_off = EXCLUDED.kick_off, venue_name = EXCLUDED.venue_name,
             gender = EXCLUDED.gender, age_group = EXCLUDED.age_group,
             format = CASE WHEN fixtures.format_override = true THEN fixtures.format ELSE EXCLUDED.format END`,
          [f.league_code, f.match_date, f.kick_off, f.home_team, f.away_team, f.venue_name, f.match_type || 'League / Cup', f.is_home_game ?? true, gender, f.age_group, format]
        );
        saved++;
      } catch (e) { /* skip dupes */ }
    }
    res.json({ success: true, saved, removed, rescheduled });
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
      // Always recompute format server-side from gender + age_group
      const fGender = f.gender || gender;
      const fFormat = computeFormat(f.age_group, fGender);
      try {
        // Check for rescheduled match (same league_code + home_team, different date)
        if (f.league_code) {
          const existing = await pool.query(
            `SELECT id, match_date FROM fixtures
             WHERE league_code = $1 AND home_team = $2 AND match_date != $3`,
            [f.league_code, f.home_team, f.match_date]
          );
          if (existing.rows.length > 0) {
            await pool.query(
              `UPDATE fixtures SET match_date = $1, kick_off = $2, venue_name = $3,
               gender = $4, age_group = $5,
               format = CASE WHEN format_override = true THEN format ELSE $6 END
               WHERE id = $7`,
              [f.match_date, f.kick_off, f.venue_name, fGender, f.age_group, fFormat, existing.rows[0].id]
            );
            saved++;
            continue;
          }
        }
        await pool.query(
          `INSERT INTO fixtures (league_code, match_date, kick_off, home_team, away_team, venue_name, match_type, is_home_game, gender, age_group, format)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (match_date, home_team, away_team) DO UPDATE SET
             kick_off = EXCLUDED.kick_off, venue_name = EXCLUDED.venue_name,
             gender = EXCLUDED.gender, age_group = EXCLUDED.age_group,
             format = CASE WHEN fixtures.format_override = true THEN fixtures.format ELSE EXCLUDED.format END`,
          [f.league_code, f.match_date, f.kick_off, f.home_team, f.away_team, f.venue_name, f.match_type || 'League / Cup', f.is_home_game ?? true, fGender, f.age_group, fFormat]
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

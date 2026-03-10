const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// --- VENUES & PITCHES ---

// GET /api/venues - list all venues with pitches
router.get('/venues', async (req, res) => {
  try {
    const venues = await pool.query('SELECT * FROM venues ORDER BY name');
    const pitches = await pool.query(
      `SELECT p.*, v.name as venue_name FROM pitches p 
       JOIN venues v ON v.id = p.venue_id ORDER BY v.name, p.format`
    );

    const result = venues.rows.map(v => ({
      ...v,
      pitches: pitches.rows.filter(p => p.venue_id === v.id)
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- AD-HOC REQUESTS ---

// GET /api/requests
router.get('/requests', async (req, res) => {
  try {
    const { status } = req.query;
    let query = 'SELECT * FROM requests';
    const params = [];
    if (status) {
      query += ' WHERE status = $1';
      params.push(status);
    }
    query += ' ORDER BY created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/requests - submit a new request (friendly, pitch change, etc)
router.post('/requests', async (req, res) => {
  try {
    const { requested_by, request_type, details, match_date, kick_off, pitch_format } = req.body;
    const result = await pool.query(
      `INSERT INTO requests (requested_by, request_type, details, match_date, kick_off, pitch_format)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [requested_by, request_type, details, match_date, kick_off, pitch_format]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/requests/:id - update request status
// When approving with fixture data, also creates a fixture
router.put('/requests/:id', async (req, res) => {
  try {
    const { status, fixture } = req.body;
    const result = await pool.query(
      'UPDATE requests SET status = $1 WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );

    let createdFixture = null;
    if (status === 'approved' && fixture) {
      const boysFormatMap = { U6: '5v5', U7: '5v5', U8: '5v5', U9: '7v7', U10: '7v7', U11: '9v9', U12: '9v9', U13: '11v11', U14: '11v11', U15: '11v11', U16: '11v11', U17: '11v11', U18: '11v11' };
      const girlsFormatMap = { ...boysFormatMap, U9: '5v5', U11: '7v7', U13: '9v9', U14: '9v9' };
      const gender = fixture.gender || 'boys';
      const formatMap = gender === 'girls' ? girlsFormatMap : boysFormatMap;
      // Allow explicit format override (e.g. teams booking friendlies for next season's format)
      const format = fixture.format_override || formatMap[fixture.age_group] || fixture.pitch_format || '11v11';

      const fixtureResult = await pool.query(
        `INSERT INTO fixtures (match_date, kick_off, home_team, away_team, match_type, is_home_game, gender, age_group, format)
         VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8)
         ON CONFLICT (match_date, home_team, away_team) DO UPDATE SET
           kick_off = EXCLUDED.kick_off, gender = EXCLUDED.gender, age_group = EXCLUDED.age_group, format = EXCLUDED.format
         RETURNING *`,
        [fixture.match_date, fixture.kick_off || null, fixture.home_team, fixture.away_team, fixture.match_type || 'Friendly', gender, fixture.age_group, format]
      );
      createdFixture = fixtureResult.rows[0];
    }

    res.json({ ...result.rows[0], created_fixture: createdFixture });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

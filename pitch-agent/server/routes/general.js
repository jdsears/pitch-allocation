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

// Map a pitch format (5v5/7v7/9v9/11v11) to a sensible age group label
const FORMAT_TO_AGE = { '5v5': 'U8', '7v7': 'U10', '9v9': 'U12', '11v11': 'U13' };

// Best-effort parse of "Home v Away" / "Home vs Away" out of free-text details
function parseTeams(requested_by, details) {
  const text = (details || '').trim();
  const m = text.match(/(.+?)\s+(?:vs?\.?|v)\s+(.+)/i);
  if (m) {
    return { home: m[1].trim(), away: m[2].trim() };
  }
  // Fall back to the requester as the home side
  return { home: (requested_by || 'Morley YFC').trim(), away: text || 'Friendly (TBC)' };
}

// PUT /api/requests/:id - update request status (and create a fixture on approval)
router.put('/requests/:id', async (req, res) => {
  try {
    const { status } = req.body;
    const updated = await pool.query(
      'UPDATE requests SET status = $1 WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );
    const request = updated.rows[0];

    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    let fixture = null;

    // Approving a booking-style request (friendly / other) should create a
    // real fixture so it shows up in the allocation grid. Change/cancel
    // requests just flip status — they don't create new fixtures.
    const createsFixture = ['friendly', 'other'].includes(request.request_type);
    if (status === 'approved' && createsFixture) {
      if (!request.match_date) {
        return res.status(400).json({
          error: 'Cannot create fixture: this request has no date. Add a date before approving.',
        });
      }

      const { home, away } = parseTeams(request.requested_by, request.details);
      const format = request.pitch_format || '11v11';
      // Try to read an age group (e.g. "U10") from the request, else infer from format
      const ageMatch = `${request.requested_by || ''} ${request.details || ''}`.match(/U\d{1,2}/i);
      const ageGroup = ageMatch ? ageMatch[0].toUpperCase() : (FORMAT_TO_AGE[format] || null);

      const fixtureRes = await pool.query(
        `INSERT INTO fixtures
           (match_date, kick_off, home_team, away_team, match_type, is_home_game, gender, age_group, format)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (match_date, home_team, away_team) DO UPDATE SET
           kick_off = EXCLUDED.kick_off,
           format = EXCLUDED.format,
           is_home_game = true
         RETURNING *`,
        [
          request.match_date,
          request.kick_off || null,
          home,
          away,
          request.request_type === 'friendly' ? 'Friendly' : 'Request',
          true,
          'boys',
          ageGroup,
          format,
        ]
      );
      fixture = fixtureRes.rows[0];
    }

    res.json({ ...request, fixture });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

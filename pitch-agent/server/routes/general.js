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
router.put('/requests/:id', async (req, res) => {
  try {
    const { status } = req.body;
    const result = await pool.query(
      'UPDATE requests SET status = $1 WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

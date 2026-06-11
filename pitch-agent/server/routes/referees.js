const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');

// GET /api/referees - list all active referees
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM referees WHERE active = true ORDER BY name'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/referees - add a new referee
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, phone } = req.body;
    const result = await pool.query(
      'INSERT INTO referees (name, phone) VALUES ($1, $2) RETURNING *',
      [name, phone]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/referees/:id
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { name, phone, active } = req.body;
    const result = await pool.query(
      'UPDATE referees SET name = COALESCE($1, name), phone = COALESCE($2, phone), active = COALESCE($3, active) WHERE id = $4 RETURNING *',
      [name, phone, active, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/referees/available?date=2026-03-16 - get available refs for a date
router.get('/available', async (req, res) => {
  try {
    const { date } = req.query;
    const result = await pool.query(
      `SELECT r.* FROM referees r
       LEFT JOIN referee_availability ra ON ra.referee_id = r.id AND ra.match_date = $1
       WHERE r.active = true AND (ra.available IS NULL OR ra.available = true)
       ORDER BY r.name`,
      [date]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/referees/claim - referee claims a match
router.post('/claim', async (req, res) => {
  try {
    const { allocation_id, referee_id } = req.body;

    // Check not already claimed
    const existing = await pool.query(
      'SELECT id FROM referee_claims WHERE allocation_id = $1',
      [allocation_id]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Match already claimed by a referee' });
    }

    const result = await pool.query(
      'INSERT INTO referee_claims (allocation_id, referee_id) VALUES ($1, $2) RETURNING *',
      [allocation_id, referee_id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/referees/claim/:allocationId - unclaim a match
router.delete('/claim/:allocationId', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM referee_claims WHERE allocation_id = $1',
      [req.params.allocationId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/referees/availability - set availability for a date
router.post('/availability', async (req, res) => {
  try {
    const { referee_id, match_date, available } = req.body;
    const result = await pool.query(
      `INSERT INTO referee_availability (referee_id, match_date, available)
       VALUES ($1, $2, $3)
       ON CONFLICT (referee_id, match_date) DO UPDATE SET available = $3
       RETURNING *`,
      [referee_id, match_date, available]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

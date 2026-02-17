const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { allocateFixtures, getAllocationGrid, getWeekSummary } = require('../services/allocator');
const { sendWeeklyAllocation, formatWeeklySummary } = require('../services/whatsapp');

// GET /api/allocations/grid?week=2026-03-16
router.get('/grid', async (req, res) => {
  try {
    const grid = await getAllocationGrid(req.query.week);
    res.json(grid);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/allocations/generate - auto-allocate fixtures for a week
router.post('/generate', async (req, res) => {
  try {
    const { week } = req.body;
    const result = await allocateFixtures(week);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/allocations/:id - update a single allocation (Guy's manual tweaks)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { pitch_id, allocated_kick_off, camera, notes, status } = req.body;

    const fields = [];
    const params = [];
    let idx = 1;

    if (pitch_id !== undefined) { fields.push(`pitch_id = $${idx++}`); params.push(pitch_id); }
    if (allocated_kick_off !== undefined) { fields.push(`allocated_kick_off = $${idx++}`); params.push(allocated_kick_off); }
    if (camera !== undefined) { fields.push(`camera = $${idx++}`); params.push(camera); }
    if (notes !== undefined) { fields.push(`notes = $${idx++}`); params.push(notes); }
    if (status !== undefined) { fields.push(`status = $${idx++}`); params.push(status); }

    fields.push(`updated_at = NOW()`);

    params.push(id);
    const result = await pool.query(
      `UPDATE allocations SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/allocations/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM allocations WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/allocations/confirm - confirm draft allocations and publish
router.post('/confirm', async (req, res) => {
  try {
    const { week } = req.body;
    await pool.query(
      `UPDATE allocations a SET status = 'confirmed' 
       FROM fixtures f WHERE f.id = a.fixture_id 
       AND a.week_start = $1 AND a.status = 'draft'`,
      [week]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/allocations/summary?week=2026-03-16
router.get('/summary', async (req, res) => {
  try {
    const summary = await getWeekSummary(req.query.week);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/allocations/publish - confirm + send WhatsApp message
router.post('/publish', async (req, res) => {
  try {
    const { week } = req.body;
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const gridUrl = `${baseUrl}/grid?week=${week}`;

    // Confirm all drafts
    await pool.query(
      `UPDATE allocations a SET status = 'confirmed' 
       FROM fixtures f WHERE f.id = a.fixture_id 
       AND a.week_start = $1 AND a.status = 'draft'`,
      [week]
    );

    // Get summary and send WhatsApp
    const waResult = await sendWeeklyAllocation(week, gridUrl);

    res.json({
      success: true,
      whatsapp: waResult,
      message: waResult.message
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

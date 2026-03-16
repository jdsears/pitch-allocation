const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { allocateFixtures, getAllocationGrid, getWeekSummary, getMultiWeekOverview } = require('../services/allocator');
const { sendWeeklyAllocation, formatWeeklySummary, generateOverviewMessage } = require('../services/whatsapp');

// GET /api/allocations/overview?weeks=4
router.get('/overview', async (req, res) => {
  try {
    const weeks = parseInt(req.query.weeks) || 4;
    const overview = await getMultiWeekOverview(req.query.week, weeks);
    res.json(overview);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

// POST /api/allocations/overview-message - generate 4-week overview WhatsApp message
router.post('/overview-message', async (req, res) => {
  try {
    const { week, weeks } = req.body;
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const message = await generateOverviewMessage(week, weeks || 4, baseUrl);
    res.json({ message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/allocations/calendar?weeks=4 - calendar data for Sat/Sun across N weeks
router.get('/calendar', async (req, res) => {
  try {
    const { startOfWeek: startOfWeekFn, addDays, format: fmtDate } = require('date-fns');
    const weeks = parseInt(req.query.weeks) || 4;
    const weekStart = req.query.week || fmtDate(startOfWeekFn(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const calendarEnd = fmtDate(addDays(new Date(weekStart), weeks * 7 - 1), 'yyyy-MM-dd');

    // All allocations in range
    const allocResult = await pool.query(
      `SELECT
         a.id as allocation_id, a.allocated_kick_off, a.status, a.camera, a.notes,
         f.match_date, f.home_team, f.away_team, f.age_group, f.format, f.gender, f.kick_off as fixture_kick_off,
         p.name as pitch_name, p.format as pitch_format,
         v.name as venue_name,
         r.name as referee_name
       FROM allocations a
       JOIN fixtures f ON f.id = a.fixture_id
       JOIN pitches p ON p.id = a.pitch_id
       JOIN venues v ON v.id = p.venue_id
       LEFT JOIN referee_claims rc ON rc.allocation_id = a.id
       LEFT JOIN referees r ON r.id = rc.referee_id
       WHERE f.match_date BETWEEN $1 AND $2
       ORDER BY v.name, p.format, f.match_date, a.allocated_kick_off`,
      [weekStart, calendarEnd]
    );

    // Unallocated home fixtures
    const unallocResult = await pool.query(
      `SELECT f.* FROM fixtures f
       LEFT JOIN allocations a ON a.fixture_id = f.id
       WHERE f.is_home_game = true
       AND f.match_date BETWEEN $1 AND $2
       AND a.id IS NULL
       ORDER BY f.match_date, f.kick_off`,
      [weekStart, calendarEnd]
    );

    // Build list of Sat/Sun dates in range
    const dates = [];
    const start = new Date(weekStart);
    for (let i = 0; i < weeks * 7; i++) {
      const d = addDays(start, i);
      const day = d.getDay();
      if (day === 0 || day === 6) {
        dates.push(fmtDate(d, 'yyyy-MM-dd'));
      }
    }

    // Helper to normalise date
    function toDS(val) {
      if (!val) return null;
      if (val instanceof Date) {
        const y = val.getFullYear();
        const m = String(val.getMonth() + 1).padStart(2, '0');
        const d = String(val.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
      const s = String(val);
      const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      return match ? match[0] : null;
    }

    res.json({
      weekStart,
      calendarEnd,
      dates,
      allocations: allocResult.rows.map(r => ({ ...r, match_date: toDS(r.match_date) })),
      unallocated: unallocResult.rows.map(r => ({ ...r, match_date: toDS(r.match_date) })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

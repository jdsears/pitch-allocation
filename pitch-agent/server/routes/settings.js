const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { loadClosure, saveClosure, validateClosure } = require('../lib/shrophamClosure');
const { previewClosure } = require('../services/allocator');

// GET /api/settings/shropham-closure — current plan (read by the grid banner)
router.get('/shropham-closure', async (req, res) => {
  try {
    res.json(await loadClosure(pool));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings/shropham-closure — switch the Morley-only plan on/off
router.put('/shropham-closure', async (req, res) => {
  const { value, error } = validateClosure(req.body);
  if (error) return res.status(400).json({ error });
  try {
    res.json(await saveClosure(pool, value));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/shropham-closure/preview — practice run, nothing saved
router.post('/shropham-closure/preview', async (req, res) => {
  const { value, error } = validateClosure({ ...req.body, enabled: true });
  if (error) return res.status(400).json({ error });
  try {
    res.json(await previewClosure(value));
  } catch (err) {
    console.error('Closure preview error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// Age group -> default pitch format (kept in step with the scraper's mapping)
const AGE_TO_FORMAT = {
  U6: '5v5', U7: '5v5', U8: '5v5', U9: '7v7', U10: '7v7',
  U11: '9v9', U12: '9v9', U13: '11v11', U14: '11v11', U15: '11v11',
  U16: '11v11', U17: '11v11', U18: '11v11',
};
const formatForAge = (age) => AGE_TO_FORMAT[age] || '11v11';
const ageNumber = (age) => {
  const m = (age || '').match(/U(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
};

// GET /api/teams - list teams (optionally only active)
router.get('/', async (req, res) => {
  try {
    const onlyActive = req.query.active === 'true';
    const result = await pool.query(
      `SELECT t.*, v.name AS home_venue_name
         FROM teams t
         LEFT JOIN venues v ON v.id = t.home_venue_id
         ${onlyActive ? 'WHERE t.active = true' : ''}
         ORDER BY t.active DESC, t.gender, t.age_group NULLS LAST, t.name`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/teams - create a team
router.post('/', async (req, res) => {
  const { name, age_group, format, gender, coaches, home_venue_id, default_camera, active } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Team name is required' });
  try {
    const result = await pool.query(
      `INSERT INTO teams (name, age_group, format, gender, coaches, home_venue_id, default_camera, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, true))
       RETURNING *`,
      [
        name.trim(),
        age_group || null,
        format || (age_group ? formatForAge(age_group) : null),
        gender || 'boys',
        coaches || null,
        home_venue_id || null,
        default_camera || null,
        active,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A team with that name already exists' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/teams/:id - partial update (only the fields supplied are changed,
// so e.g. an active-toggle never wipes a team's venue/format/coaches)
const UPDATABLE = ['name', 'age_group', 'format', 'gender', 'coaches', 'home_venue_id', 'default_camera', 'active'];
router.put('/:id', async (req, res) => {
  const sets = [];
  const params = [];
  let idx = 1;
  for (const key of UPDATABLE) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) {
      sets.push(`${key} = $${idx++}`);
      const v = req.body[key];
      params.push(v === '' ? null : v); // empty string clears the field
    }
  }
  if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });
  params.push(req.params.id);
  try {
    const result = await pool.query(
      `UPDATE teams SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Team not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A team with that name already exists' });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/teams/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM teams WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Team not found' });
    res.json({ deleted: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/teams/sync-from-fixtures - auto-seed teams from scraped home fixtures
router.post('/sync-from-fixtures', async (req, res) => {
  try {
    // One row per distinct Morley home team that appears in fixtures
    const distinct = await pool.query(
      `SELECT DISTINCT ON (home_team) home_team, gender, age_group, format
         FROM fixtures
         WHERE is_home_game = true AND home_team ILIKE '%morley%'
         ORDER BY home_team, match_date DESC`
    );
    let added = 0;
    for (const row of distinct.rows) {
      const result = await pool.query(
        `INSERT INTO teams (name, age_group, format, gender)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (name) DO NOTHING
         RETURNING id`,
        [row.home_team, row.age_group, row.format || formatForAge(row.age_group), row.gender || 'boys']
      );
      if (result.rows.length > 0) added++;
    }
    res.json({ added, scanned: distinct.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Build the rollover plan: every active team moves up one age group.
async function buildRolloverPlan() {
  const teams = await pool.query(
    `SELECT id, name, age_group, format, gender FROM teams WHERE active = true`
  );
  // Highest age first (numeric, not string) so a promoted name never collides
  // with a team that hasn't been moved yet (U14->U15 before U13->U14).
  const rows = teams.rows.sort((a, b) => (ageNumber(b.age_group) || 0) - (ageNumber(a.age_group) || 0));
  return rows.map((t) => {
    const n = ageNumber(t.age_group);
    if (n === null) {
      return { id: t.id, name: t.name, from: t.age_group, change: 'skip',
               reason: 'No age group set', new_name: t.name, new_age: t.age_group,
               new_format: t.format, archive: false };
    }
    if (n >= 18) {
      return { id: t.id, name: t.name, from: t.age_group, change: 'archive',
               new_name: t.name, new_age: t.age_group, new_format: t.format, archive: true };
    }
    const newAge = `U${n + 1}`;
    // Replace this team's exact age token (e.g. U13, including "U13s") but not
    // a different number like U18; leaves the name unchanged if it has no token.
    const newName = t.name.replace(new RegExp(`U${n}(?![0-9])`, 'gi'), newAge);
    return { id: t.id, name: t.name, from: t.age_group, change: 'promote',
             new_name: newName, new_age: newAge, new_format: formatForAge(newAge), archive: false };
  });
}

// GET /api/teams/rollover/preview - show what a season rollover would do
router.get('/rollover/preview', async (req, res) => {
  try {
    res.json({ plan: await buildRolloverPlan() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/teams/rollover/apply - apply the season rollover
router.post('/rollover/apply', async (req, res) => {
  const client = await pool.connect();
  try {
    const plan = await buildRolloverPlan();
    await client.query('BEGIN');
    let promoted = 0, archived = 0;
    // Highest age first so renamed names never collide with a not-yet-moved team
    for (const p of plan) {
      if (p.change === 'archive') {
        await client.query('UPDATE teams SET active = false WHERE id = $1', [p.id]);
        archived++;
      } else if (p.change === 'promote') {
        await client.query(
          'UPDATE teams SET name = $1, age_group = $2, format = $3 WHERE id = $4',
          [p.new_name, p.new_age, p.new_format, p.id]
        );
        promoted++;
      }
    }
    await client.query('COMMIT');
    res.json({ promoted, archived });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;

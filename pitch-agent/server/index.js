require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const fixtureRoutes = require('./routes/fixtures');
const allocationRoutes = require('./routes/allocations');
const refereeRoutes = require('./routes/referees');
const generalRoutes = require('./routes/general');
const teamRoutes = require('./routes/teams');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// One-time database setup endpoint (migrate + seed)
app.post('/api/setup', async (req, res) => {
  const pool = require('./db/pool');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // --- MIGRATE ---
    await client.query(`CREATE TABLE IF NOT EXISTS venues (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS pitches (id SERIAL PRIMARY KEY, venue_id INTEGER REFERENCES venues(id), name VARCHAR(100) NOT NULL, format VARCHAR(20) NOT NULL, created_at TIMESTAMP DEFAULT NOW(), UNIQUE(venue_id, name))`);
    await client.query(`CREATE TABLE IF NOT EXISTS time_slots (id SERIAL PRIMARY KEY, pitch_id INTEGER REFERENCES pitches(id), kick_off TIME NOT NULL, day_of_week VARCHAR(10), created_at TIMESTAMP DEFAULT NOW(), UNIQUE(pitch_id, kick_off, day_of_week))`);
    await client.query(`CREATE TABLE IF NOT EXISTS teams (id SERIAL PRIMARY KEY, name VARCHAR(150) NOT NULL, age_group VARCHAR(10), format VARCHAR(20), gender VARCHAR(10) DEFAULT 'boys', coaches TEXT, home_venue_id INTEGER REFERENCES venues(id), created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS fixtures (id SERIAL PRIMARY KEY, league_code VARCHAR(20), match_date DATE NOT NULL, kick_off TIME, home_team VARCHAR(200) NOT NULL, away_team VARCHAR(200) NOT NULL, venue_name VARCHAR(200), match_type VARCHAR(50) DEFAULT 'League / Cup', is_home_game BOOLEAN DEFAULT false, gender VARCHAR(10) DEFAULT 'boys', age_group VARCHAR(10), format VARCHAR(20), source_url TEXT, scraped_at TIMESTAMP DEFAULT NOW(), UNIQUE(match_date, home_team, away_team))`);
    await client.query(`CREATE TABLE IF NOT EXISTS allocations (id SERIAL PRIMARY KEY, fixture_id INTEGER REFERENCES fixtures(id), pitch_id INTEGER REFERENCES pitches(id), time_slot_id INTEGER REFERENCES time_slots(id), allocated_kick_off TIME, referee_id INTEGER, camera VARCHAR(100), status VARCHAR(20) DEFAULT 'draft', notes TEXT, week_start DATE, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS referees (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, phone VARCHAR(20), whatsapp_id VARCHAR(50), active BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS referee_availability (id SERIAL PRIMARY KEY, referee_id INTEGER REFERENCES referees(id), match_date DATE NOT NULL, available BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT NOW(), UNIQUE(referee_id, match_date))`);
    await client.query(`CREATE TABLE IF NOT EXISTS referee_claims (id SERIAL PRIMARY KEY, allocation_id INTEGER REFERENCES allocations(id), referee_id INTEGER REFERENCES referees(id), status VARCHAR(20) DEFAULT 'claimed', claimed_at TIMESTAMP DEFAULT NOW(), UNIQUE(allocation_id))`);
    await client.query(`CREATE TABLE IF NOT EXISTS requests (id SERIAL PRIMARY KEY, requested_by VARCHAR(100), request_type VARCHAR(50), details TEXT, match_date DATE, kick_off TIME, pitch_format VARCHAR(20), status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS allocation_history (id SERIAL PRIMARY KEY, team_name VARCHAR(150), pitch_id INTEGER REFERENCES pitches(id), kick_off TIME, match_date DATE, created_at TIMESTAMP DEFAULT NOW())`);

    // --- MIGRATE additions ---
    await client.query(`ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS format_override BOOLEAN DEFAULT false`);
    await client.query(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true`);
    await client.query(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS default_camera VARCHAR(100)`);
    // Age restrictions: Shropham 11v11 is U14 max, Morley 11v11 is U15 min
    await client.query(`ALTER TABLE pitches ADD COLUMN IF NOT EXISTS max_age_group VARCHAR(10)`);
    await client.query(`ALTER TABLE pitches ADD COLUMN IF NOT EXISTS min_age_group VARCHAR(10)`);

    // --- SEED ---
    const morley = await client.query(`INSERT INTO venues (name) VALUES ('Morley') ON CONFLICT DO NOTHING RETURNING id`);
    const shropham = await client.query(`INSERT INTO venues (name) VALUES ('Shropham') ON CONFLICT DO NOTHING RETURNING id`);
    const morleyId = morley.rows[0]?.id || (await client.query(`SELECT id FROM venues WHERE name = 'Morley'`)).rows[0].id;
    const shrophamId = shropham.rows[0]?.id || (await client.query(`SELECT id FROM venues WHERE name = 'Shropham'`)).rows[0].id;

    const pitches = [
      { name: '5v5 (Main)', format: '5v5', venue: morleyId },
      { name: '7v7 (Main)', format: '7v7', venue: morleyId },
      { name: '11v11', format: '11v11', venue: morleyId },
      { name: '9v9', format: '9v9', venue: shrophamId },
      { name: '11v11', format: '11v11', venue: shrophamId },
    ];

    for (const pitch of pitches) {
      const result = await client.query(
        `INSERT INTO pitches (venue_id, name, format) VALUES ($1, $2, $3) ON CONFLICT (venue_id, name) DO NOTHING RETURNING id`,
        [pitch.venue, pitch.name, pitch.format]
      );
      const pitchId = result.rows[0]?.id || (await client.query(`SELECT id FROM pitches WHERE venue_id = $1 AND name = $2`, [pitch.venue, pitch.name])).rows[0].id;

      const slots = pitch.venue === morleyId
        ? [{ ko: '10:00', day: 'Saturday' }, { ko: '11:15', day: 'Saturday' }, { ko: '12:30', day: 'Saturday' }, { ko: '10:00', day: 'Sunday' }, { ko: '12:30', day: 'Sunday' }]
        : [{ ko: '10:00', day: 'Saturday' }, { ko: '12:00', day: 'Saturday' }, { ko: '14:00', day: 'Saturday' }, { ko: '10:00', day: 'Sunday' }, { ko: '12:00', day: 'Sunday' }, { ko: '14:00', day: 'Sunday' }];

      for (const slot of slots) {
        await client.query(
          `INSERT INTO time_slots (pitch_id, kick_off, day_of_week) VALUES ($1, $2, $3) ON CONFLICT (pitch_id, kick_off, day_of_week) DO NOTHING`,
          [pitchId, slot.ko, slot.day]
        );
      }
    }

    // Shropham 11v11 is undersized — U13/U14 only
    await client.query(
      `UPDATE pitches SET max_age_group = 'U14' WHERE venue_id = $1 AND format = '11v11'`,
      [shrophamId]
    );
    // Morley 11v11 is full size — U15+ only (U13/U14 must go to Shropham)
    await client.query(
      `UPDATE pitches SET min_age_group = 'U15' WHERE venue_id = $1 AND format = '11v11'`,
      [morleyId]
    );

    await client.query('COMMIT');
    res.json({ status: 'ok', message: 'Migration and seed complete', venues: { morleyId, shrophamId } });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ status: 'error', message: err.message });
  } finally {
    client.release();
  }
});

// Auto-migrate: ensure new columns exist on every server start
(async () => {
  try {
    const pool = require('./db/pool');
    // format_override flag for fixtures (added for manual format changes)
    await pool.query(`ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS format_override BOOLEAN DEFAULT false`);
    // Age restriction columns for pitches
    await pool.query(`ALTER TABLE pitches ADD COLUMN IF NOT EXISTS max_age_group VARCHAR(10)`);
    await pool.query(`ALTER TABLE pitches ADD COLUMN IF NOT EXISTS min_age_group VARCHAR(10)`);
    // Shropham 11v11: U14 max (undersized pitch)
    await pool.query(
      `UPDATE pitches SET max_age_group = 'U14'
       WHERE venue_id = (SELECT id FROM venues WHERE name = 'Shropham' LIMIT 1)
       AND format = '11v11' AND max_age_group IS NULL`
    );
    // Morley 11v11: U15 min (U13/U14 must go to Shropham)
    await pool.query(
      `UPDATE pitches SET min_age_group = 'U15'
       WHERE venue_id = (SELECT id FROM venues WHERE name = 'Morley' LIMIT 1)
       AND format = '11v11' AND min_age_group IS NULL`
    );
    // Team-management columns (active flag + default camera)
    await pool.query(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true`);
    await pool.query(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS default_camera VARCHAR(100)`);
    // Unique team name — only add if existing data has no duplicates, otherwise
    // the index creation would throw and abort the rest of the migration.
    const dupTeam = await pool.query(`SELECT 1 FROM teams GROUP BY name HAVING COUNT(*) > 1 LIMIT 1`);
    if (dupTeam.rows.length === 0) {
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS teams_name_unique ON teams (name)`);
    } else {
      console.warn('Skipping teams_name_unique index: duplicate team names exist — de-duplicate then restart');
    }
    console.log('Auto-migration: format_override + pitch age restrictions + team columns ready');
  } catch (err) {
    // Tables may not exist yet (first run before /api/setup) — that's OK
    console.log('Auto-migration skipped (tables may not exist yet):', err.message);
  }
})();

// API Routes
app.use('/api/fixtures', fixtureRoutes);
app.use('/api/allocations', allocationRoutes);
app.use('/api/referees', refereeRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api', generalRoutes);

// Serve React build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Morley Pitch Agent running on port ${PORT}`);
});

module.exports = app;

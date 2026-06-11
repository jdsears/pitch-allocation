/**
 * Single source of truth for the database schema.
 *
 * ensureSchema(queryable) is idempotent — every statement is IF NOT EXISTS
 * or guarded — and is called from three places that previously each carried
 * their own (drifting) copy of the DDL: server boot, POST /api/setup, and
 * db/migrate.js. Add new tables/columns HERE and nowhere else.
 */

async function ensureSchema(q) {
  // --- Tables ---
  await q.query(`CREATE TABLE IF NOT EXISTS venues (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE, created_at TIMESTAMP DEFAULT NOW())`);
  await q.query(`CREATE TABLE IF NOT EXISTS pitches (id SERIAL PRIMARY KEY, venue_id INTEGER REFERENCES venues(id), name VARCHAR(100) NOT NULL, format VARCHAR(20) NOT NULL, created_at TIMESTAMP DEFAULT NOW(), UNIQUE(venue_id, name))`);
  await q.query(`CREATE TABLE IF NOT EXISTS time_slots (id SERIAL PRIMARY KEY, pitch_id INTEGER REFERENCES pitches(id), kick_off TIME NOT NULL, day_of_week VARCHAR(10), created_at TIMESTAMP DEFAULT NOW(), UNIQUE(pitch_id, kick_off, day_of_week))`);
  await q.query(`CREATE TABLE IF NOT EXISTS teams (id SERIAL PRIMARY KEY, name VARCHAR(150) NOT NULL, age_group VARCHAR(10), format VARCHAR(20), gender VARCHAR(10) DEFAULT 'boys', coaches TEXT, home_venue_id INTEGER REFERENCES venues(id), created_at TIMESTAMP DEFAULT NOW())`);
  await q.query(`CREATE TABLE IF NOT EXISTS fixtures (id SERIAL PRIMARY KEY, league_code VARCHAR(20), match_date DATE NOT NULL, kick_off TIME, home_team VARCHAR(200) NOT NULL, away_team VARCHAR(200) NOT NULL, venue_name VARCHAR(200), match_type VARCHAR(50) DEFAULT 'League / Cup', is_home_game BOOLEAN DEFAULT false, gender VARCHAR(10) DEFAULT 'boys', age_group VARCHAR(10), format VARCHAR(20), source_url TEXT, scraped_at TIMESTAMP DEFAULT NOW(), UNIQUE(match_date, home_team, away_team))`);
  await q.query(`CREATE TABLE IF NOT EXISTS allocations (id SERIAL PRIMARY KEY, fixture_id INTEGER REFERENCES fixtures(id), pitch_id INTEGER REFERENCES pitches(id), time_slot_id INTEGER REFERENCES time_slots(id), allocated_kick_off TIME, referee_id INTEGER, camera VARCHAR(100), status VARCHAR(20) DEFAULT 'draft', notes TEXT, week_start DATE, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())`);
  await q.query(`CREATE TABLE IF NOT EXISTS referees (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, phone VARCHAR(20), whatsapp_id VARCHAR(50), active BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT NOW())`);
  await q.query(`CREATE TABLE IF NOT EXISTS referee_availability (id SERIAL PRIMARY KEY, referee_id INTEGER REFERENCES referees(id), match_date DATE NOT NULL, available BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT NOW(), UNIQUE(referee_id, match_date))`);
  await q.query(`CREATE TABLE IF NOT EXISTS referee_claims (id SERIAL PRIMARY KEY, allocation_id INTEGER REFERENCES allocations(id), referee_id INTEGER REFERENCES referees(id), status VARCHAR(20) DEFAULT 'claimed', claimed_at TIMESTAMP DEFAULT NOW(), UNIQUE(allocation_id))`);
  await q.query(`CREATE TABLE IF NOT EXISTS requests (id SERIAL PRIMARY KEY, requested_by VARCHAR(100), request_type VARCHAR(50), details TEXT, match_date DATE, kick_off TIME, pitch_format VARCHAR(20), status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW())`);
  await q.query(`CREATE TABLE IF NOT EXISTS allocation_history (id SERIAL PRIMARY KEY, team_name VARCHAR(150), pitch_id INTEGER REFERENCES pitches(id), kick_off TIME, match_date DATE, created_at TIMESTAMP DEFAULT NOW())`);
  // Persisted scrape run log (status survives restarts/redeploys)
  await q.query(`CREATE TABLE IF NOT EXISTS scrape_runs (id SERIAL PRIMARY KEY, source VARCHAR(20), started_at TIMESTAMP DEFAULT NOW(), finished_at TIMESTAMP, total INTEGER, saved INTEGER, rescheduled INTEGER, error TEXT)`);

  // --- Columns added after launch ---
  await q.query(`ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS format_override BOOLEAN DEFAULT false`);
  await q.query(`ALTER TABLE pitches ADD COLUMN IF NOT EXISTS max_age_group VARCHAR(10)`);
  await q.query(`ALTER TABLE pitches ADD COLUMN IF NOT EXISTS min_age_group VARCHAR(10)`);
  await q.query(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true`);
  await q.query(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS default_camera VARCHAR(100)`);

  // --- Constraints (guarded: ADD CONSTRAINT has no IF NOT EXISTS) ---
  // Referee FK so deleting a referee can't leave dangling allocation refs
  await q.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allocations_referee_fk') THEN
        ALTER TABLE allocations ADD CONSTRAINT allocations_referee_fk
          FOREIGN KEY (referee_id) REFERENCES referees(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  // Unique team name — only when existing data has no duplicates, otherwise
  // index creation would throw and abort the rest of the migration
  const dupTeam = await q.query(`SELECT 1 FROM teams GROUP BY name HAVING COUNT(*) > 1 LIMIT 1`);
  if (dupTeam.rows.length === 0) {
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS teams_name_unique ON teams (name)`);
  } else {
    console.warn('Skipping teams_name_unique index: duplicate team names exist — de-duplicate then restart');
  }

  // --- Indexes for the hot allocation-week queries ---
  await q.query(`CREATE INDEX IF NOT EXISTS idx_fixtures_home_date ON fixtures (is_home_game, match_date)`);
  await q.query(`CREATE INDEX IF NOT EXISTS idx_allocations_week ON allocations (week_start)`);
  await q.query(`CREATE INDEX IF NOT EXISTS idx_allocations_fixture ON allocations (fixture_id)`);

  // --- Data rules that must hold even on old rows ---
  // Shropham 11v11 is undersized (U14 max); Morley 11v11 is full size (U15 min)
  await q.query(
    `UPDATE pitches SET max_age_group = 'U14'
     WHERE venue_id = (SELECT id FROM venues WHERE name = 'Shropham' LIMIT 1)
     AND format = '11v11' AND max_age_group IS NULL`
  );
  await q.query(
    `UPDATE pitches SET min_age_group = 'U15'
     WHERE venue_id = (SELECT id FROM venues WHERE name = 'Morley' LIMIT 1)
     AND format = '11v11' AND min_age_group IS NULL`
  );
}

module.exports = { ensureSchema };

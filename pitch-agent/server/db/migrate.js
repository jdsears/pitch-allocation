require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const migrate = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Venues (Morley, Shropham)
    await client.query(`
      CREATE TABLE IF NOT EXISTS venues (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Pitches at each venue
    await client.query(`
      CREATE TABLE IF NOT EXISTS pitches (
        id SERIAL PRIMARY KEY,
        venue_id INTEGER REFERENCES venues(id),
        name VARCHAR(100) NOT NULL,
        format VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(venue_id, name)
      )
    `);

    // Time slots for each pitch
    await client.query(`
      CREATE TABLE IF NOT EXISTS time_slots (
        id SERIAL PRIMARY KEY,
        pitch_id INTEGER REFERENCES pitches(id),
        kick_off TIME NOT NULL,
        day_of_week VARCHAR(10),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(pitch_id, kick_off, day_of_week)
      )
    `);

    // Teams
    await client.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        age_group VARCHAR(10),
        format VARCHAR(20),
        gender VARCHAR(10) DEFAULT 'boys',
        coaches TEXT,
        home_venue_id INTEGER REFERENCES venues(id),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Fixtures scraped from FA Full-Time
    await client.query(`
      CREATE TABLE IF NOT EXISTS fixtures (
        id SERIAL PRIMARY KEY,
        league_code VARCHAR(20),
        match_date DATE NOT NULL,
        kick_off TIME,
        home_team VARCHAR(200) NOT NULL,
        away_team VARCHAR(200) NOT NULL,
        venue_name VARCHAR(200),
        match_type VARCHAR(50) DEFAULT 'League / Cup',
        is_home_game BOOLEAN DEFAULT false,
        gender VARCHAR(10) DEFAULT 'boys',
        age_group VARCHAR(10),
        format VARCHAR(20),
        source_url TEXT,
        scraped_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(match_date, home_team, away_team)
      )
    `);

    // Allocations - the core output
    await client.query(`
      CREATE TABLE IF NOT EXISTS allocations (
        id SERIAL PRIMARY KEY,
        fixture_id INTEGER REFERENCES fixtures(id),
        pitch_id INTEGER REFERENCES pitches(id),
        time_slot_id INTEGER REFERENCES time_slots(id),
        allocated_kick_off TIME,
        referee_id INTEGER,
        camera VARCHAR(100),
        status VARCHAR(20) DEFAULT 'draft',
        notes TEXT,
        week_start DATE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Referees
    await client.query(`
      CREATE TABLE IF NOT EXISTS referees (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        phone VARCHAR(20),
        whatsapp_id VARCHAR(50),
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Referee availability
    await client.query(`
      CREATE TABLE IF NOT EXISTS referee_availability (
        id SERIAL PRIMARY KEY,
        referee_id INTEGER REFERENCES referees(id),
        match_date DATE NOT NULL,
        available BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(referee_id, match_date)
      )
    `);

    // Referee claims on allocations
    await client.query(`
      CREATE TABLE IF NOT EXISTS referee_claims (
        id SERIAL PRIMARY KEY,
        allocation_id INTEGER REFERENCES allocations(id),
        referee_id INTEGER REFERENCES referees(id),
        status VARCHAR(20) DEFAULT 'claimed',
        claimed_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(allocation_id)
      )
    `);

    // Ad-hoc requests (friendlies, changes)
    await client.query(`
      CREATE TABLE IF NOT EXISTS requests (
        id SERIAL PRIMARY KEY,
        requested_by VARCHAR(100),
        request_type VARCHAR(50),
        details TEXT,
        match_date DATE,
        kick_off TIME,
        pitch_format VARCHAR(20),
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Allocation history for rotation tracking
    await client.query(`
      CREATE TABLE IF NOT EXISTS allocation_history (
        id SERIAL PRIMARY KEY,
        team_name VARCHAR(150),
        pitch_id INTEGER REFERENCES pitches(id),
        kick_off TIME,
        match_date DATE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query('COMMIT');
    console.log('Migration complete');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
};

migrate();

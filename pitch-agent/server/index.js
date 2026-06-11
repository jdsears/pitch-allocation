require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const { runScrape } = require('./services/scraper');
const { requireAdmin, requireAdminForMutations, login, verifyToken, authEnabled } = require('./middleware/auth');
const { ensureSchema } = require('./db/schema');

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

// Admin auth: exchange the shared password for a bearer token
app.post('/api/auth/login', (req, res) => {
  if (!authEnabled()) return res.json({ token: null, required: false });
  const token = login(req.body?.password);
  if (!token) return res.status(401).json({ error: 'Wrong password' });
  res.json({ token, required: true });
});

// Admin auth: is auth on, and is the caller's token valid?
app.get('/api/auth/status', (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  res.json({ required: authEnabled(), ok: verifyToken(token) });
});

// One-time database setup endpoint (migrate + seed)
app.post('/api/setup', requireAdmin, async (req, res) => {
  const pool = require('./db/pool');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // --- MIGRATE (single source of truth in db/schema.js) ---
    await ensureSchema(client);

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

// Auto-migrate on every boot: schema lives in one place (db/schema.js) and
// every statement is idempotent, so this is safe to run repeatedly.
(async () => {
  try {
    const pool = require('./db/pool');
    await ensureSchema(pool);
    console.log('Auto-migration: schema ensured');
  } catch (err) {
    // DB may be unreachable on first boot — that's OK, /api/setup can seed later
    console.log('Auto-migration skipped:', err.message);
  }
})();

// API Routes. Reads stay open (refs/parents view the grid); mutations need
// admin auth — except referee claim/availability and the public request
// form, which keep their own selective guards inside their route files.
app.use('/api/fixtures', requireAdminForMutations, fixtureRoutes);
app.use('/api/allocations', requireAdminForMutations, allocationRoutes);
app.use('/api/referees', refereeRoutes);
app.use('/api/teams', requireAdminForMutations, teamRoutes);
app.use('/api', generalRoutes);

// Serve React build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
  });
}

// Daily automatic fixture scrape. Runs at 06:00 UK time so fixtures are fresh
// each morning without anyone clicking "Scrape now". Pin the timezone so the
// hour is correct regardless of the container's clock (which is typically UTC).
const SCRAPE_CRON = process.env.SCRAPE_CRON || '0 6 * * *';
const SCRAPE_TZ = process.env.SCRAPE_TZ || 'Europe/London';
if (cron.validate(SCRAPE_CRON)) {
  cron.schedule(SCRAPE_CRON, async () => {
    console.log('[cron] Daily fixture scrape starting');
    try {
      // FA Full-Time is flaky — retry up to 3 times, a minute apart
      const result = await runScrape('scheduled', { attempts: 3 });
      console.log('[cron] Daily fixture scrape complete:', JSON.stringify(result));
    } catch (err) {
      console.error('[cron] Daily fixture scrape failed:', err.message);
    }
  }, { timezone: SCRAPE_TZ });
  console.log(`Scheduled daily fixture scrape: "${SCRAPE_CRON}" (${SCRAPE_TZ})`);
} else {
  console.warn(`Invalid SCRAPE_CRON "${SCRAPE_CRON}" — daily scrape not scheduled`);
}

app.listen(PORT, () => {
  console.log(`Morley Pitch Agent running on port ${PORT}`);
});

module.exports = app;

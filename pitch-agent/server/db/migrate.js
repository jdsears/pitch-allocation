require('dotenv').config();
const { Pool } = require('pg');
const { ensureSchema } = require('./schema');

// Standalone migration runner: `node db/migrate.js`.
// All DDL lives in db/schema.js (also run automatically at server boot).

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const migrate = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureSchema(client);
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

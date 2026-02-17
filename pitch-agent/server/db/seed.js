require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const seed = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Venues
    const morley = await client.query(
      `INSERT INTO venues (name) VALUES ('Morley') ON CONFLICT DO NOTHING RETURNING id`
    );
    const shropham = await client.query(
      `INSERT INTO venues (name) VALUES ('Shropham') ON CONFLICT DO NOTHING RETURNING id`
    );

    const morleyId = morley.rows[0]?.id || (await client.query(`SELECT id FROM venues WHERE name = 'Morley'`)).rows[0].id;
    const shrophamId = shropham.rows[0]?.id || (await client.query(`SELECT id FROM venues WHERE name = 'Shropham'`)).rows[0].id;

    // Morley pitches
    const morleyPitches = [
      { name: '5v5 (Main)', format: '5v5', venue: morleyId },
      { name: '7v7 (Main)', format: '7v7', venue: morleyId },
      { name: '11v11', format: '11v11', venue: morleyId },
    ];

    // Shropham pitches (U12B plays here Saturdays, plus Sunday games)
    const shrophamPitches = [
      { name: '9v9', format: '9v9', venue: shrophamId },
      { name: '11v11', format: '11v11', venue: shrophamId },
    ];

    const allPitches = [...morleyPitches, ...shrophamPitches];

    for (const pitch of allPitches) {
      const result = await client.query(
        `INSERT INTO pitches (venue_id, name, format) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (venue_id, name) DO NOTHING RETURNING id`,
        [pitch.venue, pitch.name, pitch.format]
      );

      const pitchId = result.rows[0]?.id || 
        (await client.query(`SELECT id FROM pitches WHERE venue_id = $1 AND name = $2`, [pitch.venue, pitch.name])).rows[0].id;

      // Time slots are venue + day specific:
      // Morley Saturday (girls + U12B overflow): 10:00, 11:15, 12:30
      // Morley Sunday (boys): 10:00, 12:30
      // Shropham Saturday (U12B): 10:00, 12:00, 14:00
      // Shropham Sunday (boys): 10:00, 12:00, 14:00
      
      let slots;
      if (pitch.venue === morleyId) {
        slots = [
          { ko: '10:00', day: 'Saturday' },
          { ko: '11:15', day: 'Saturday' },
          { ko: '12:30', day: 'Saturday' },
          { ko: '10:00', day: 'Sunday' },
          { ko: '12:30', day: 'Sunday' },
        ];
      } else {
        // Shropham - same slots for Sat and Sun
        slots = [
          { ko: '10:00', day: 'Saturday' },
          { ko: '12:00', day: 'Saturday' },
          { ko: '14:00', day: 'Saturday' },
          { ko: '10:00', day: 'Sunday' },
          { ko: '12:00', day: 'Sunday' },
          { ko: '14:00', day: 'Sunday' },
        ];
      }
      
      for (const slot of slots) {
        await client.query(
          `INSERT INTO time_slots (pitch_id, kick_off, day_of_week) 
           VALUES ($1, $2, $3) 
           ON CONFLICT (pitch_id, kick_off, day_of_week) DO NOTHING`,
          [pitchId, slot.ko, slot.day]
        );
      }
    }

    await client.query('COMMIT');
    console.log('Seed complete');
    console.log(`Morley venue ID: ${morleyId}`);
    console.log(`Shropham venue ID: ${shrophamId}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
};

seed();

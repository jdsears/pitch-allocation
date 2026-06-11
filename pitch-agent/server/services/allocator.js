const pool = require('../db/pool');
const { format, startOfWeek, addDays } = require('date-fns');

/**
 * Get the last kick-off time a team was allocated (most recent match)
 */
async function getLastKickOff(teamName, pitchId) {
  const result = await pool.query(
    `SELECT kick_off FROM allocation_history 
     WHERE team_name ILIKE $1 AND pitch_id = $2 
     ORDER BY match_date DESC LIMIT 1`,
    [`%${teamName}%`, pitchId]
  );
  return result.rows[0]?.kick_off || null;
}

/**
 * Get day of week from a YYYY-MM-DD date string
 * Parses explicitly to avoid timezone-related off-by-one
 */
function getDayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d); // local time, no UTC shift
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getDay()];
}

/**
 * Get available time slots for a specific pitch on a specific day of week
 */
async function getSlotsForPitchDay(pitchId, dayOfWeek) {
  const result = await pool.query(
    `SELECT kick_off FROM time_slots 
     WHERE pitch_id = $1 AND day_of_week = $2 
     ORDER BY kick_off`,
    [pitchId, dayOfWeek]
  );
  return result.rows.map(r => r.kick_off);
}

/**
 * Rotation logic:
 * Each team takes turns getting the 10am slot.
 * If Team A had 10:00 last week and Team B had 11:15, 
 * this week Team B gets 10:00 and Team A gets 11:15.
 * 
 * We sort competing teams by their last kick-off (earliest last = goes later this week)
 */
async function allocateWithRotation(fixtures, pitchId, availableSlots, occupiedSlots, date, client) {
  if (fixtures.length === 0 || availableSlots.length === 0) return { allocated: [], overflow: fixtures };

  const free = availableSlots.filter(s => !occupiedSlots.includes(s));
  if (free.length === 0) return { allocated: [], overflow: fixtures };

  // Get each fixture's last kick-off for rotation sorting
  const fixturesWithHistory = await Promise.all(
    fixtures.map(async (f) => {
      const lastKO = await getLastKickOff(f.home_team, pitchId);
      return { fixture: f, lastKO };
    })
  );

  // Sort: teams who had earliest KO last time go LATER this time
  // Teams with no history (or later KOs last time) get priority for early slots
  fixturesWithHistory.sort((a, b) => {
    // No history = gets early slot (treat as if they had a late KO last time)
    if (!a.lastKO && !b.lastKO) return 0;
    if (!a.lastKO) return -1; // a gets earlier slot
    if (!b.lastKO) return 1;  // b gets earlier slot
    
    // Team with LATER last KO gets the EARLIER slot this week (rotation)
    return a.lastKO < b.lastKO ? 1 : -1;
  });

  const allocated = [];
  const overflow = [];

  for (let i = 0; i < fixturesWithHistory.length; i++) {
    const { fixture } = fixturesWithHistory[i];
    if (i < free.length) {
      allocated.push({ fixture, kickOff: free[i] });
    } else {
      overflow.push(fixture);
    }
  }

  return { allocated, overflow };
}

/**
 * Main allocation function
 */
async function allocateFixtures(weekStartDate) {
  const client = await pool.connect();
  
  try {
    const weekStart = weekStartDate || format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const weekEnd = format(addDays(new Date(weekStart), 6), 'yyyy-MM-dd');

    console.log(`Allocating fixtures for week: ${weekStart} to ${weekEnd}`);

    // Get all home fixtures for this week that aren't yet allocated
    const fixtures = await client.query(
      `SELECT f.* FROM fixtures f 
       LEFT JOIN allocations a ON a.fixture_id = f.id 
       WHERE f.is_home_game = true 
       AND f.match_date BETWEEN $1 AND $2 
       AND a.id IS NULL
       ORDER BY f.match_date, f.kick_off`,
      [weekStart, weekEnd]
    );

    if (fixtures.rows.length === 0) {
      console.log('No unallocated home fixtures for this week');
      return { allocated: 0, conflicts: [] };
    }

    console.log(`Found ${fixtures.rows.length} home fixtures to allocate`);

    // Get all pitches with venue info
    const pitches = await client.query(
      `SELECT p.*, v.name as venue_name FROM pitches p
       JOIN venues v ON v.id = p.venue_id
       ORDER BY v.name, p.format`
    );

    // Per-team overrides (home venue, format exception, default camera),
    // keyed on the exact FA home-team name we store as the team name.
    const teamRows = await client.query(
      `SELECT name, format, home_venue_id, default_camera FROM teams`
    );
    const teamOverrides = {};
    for (const t of teamRows.rows) {
      teamOverrides[t.name.trim().toLowerCase()] = t;
    }
    const overrideFor = (homeTeam) => teamOverrides[(homeTeam || '').trim().toLowerCase()] || null;

    // Apply a team's format override up front so it groups onto the right pitch
    // type (persist it so the grid stays consistent; re-scrape won't undo it).
    for (const f of fixtures.rows) {
      const ov = overrideFor(f.home_team);
      if (ov && ov.format && ov.format !== f.format) {
        await client.query('UPDATE fixtures SET format = $1 WHERE id = $2', [ov.format, f.id]);
        f.format = ov.format;
      }
    }

    const allAllocations = [];
    const conflicts = [];

    // Group fixtures by date
    const fixturesByDate = {};
    for (const fixture of fixtures.rows) {
      const date = format(new Date(fixture.match_date), 'yyyy-MM-dd');
      if (!fixturesByDate[date]) fixturesByDate[date] = [];
      fixturesByDate[date].push(fixture);
    }

    for (const [date, dateFixtures] of Object.entries(fixturesByDate)) {
      const dayOfWeek = getDayOfWeek(date);

      // Track occupied slots per pitch for this date
      const occupiedSlots = {};
      const existing = await client.query(
        `SELECT a.pitch_id, a.allocated_kick_off FROM allocations a
         JOIN fixtures f ON f.id = a.fixture_id
         WHERE f.match_date = $1`,
        [date]
      );
      for (const row of existing.rows) {
        if (!occupiedSlots[row.pitch_id]) occupiedSlots[row.pitch_id] = [];
        occupiedSlots[row.pitch_id].push(row.allocated_kick_off);
      }

      // Group this day's fixtures by required format (pitch type)
      const byFormat = {};
      for (const f of dateFixtures) {
        if (!byFormat[f.format]) byFormat[f.format] = [];
        byFormat[f.format].push(f);
      }

      // Allocate each format group to matching pitches
      for (const [reqFormat, formatFixtures] of Object.entries(byFormat)) {
        const matchingPitches = pitches.rows.filter(p => p.format === reqFormat);

        if (matchingPitches.length === 0) {
          formatFixtures.forEach(f => conflicts.push({ fixture: f, reason: `No pitch for format ${reqFormat}` }));
          continue;
        }

        const allocatedIds = new Set();

        // Fill one pitch from a candidate list, saving allocations + history
        const fillPitch = async (candidates, pitch) => {
          if (candidates.length === 0) return;
          if (!occupiedSlots[pitch.id]) occupiedSlots[pitch.id] = [];

          const daySlots = await getSlotsForPitchDay(pitch.id, dayOfWeek);
          if (daySlots.length === 0) return;

          const { allocated } = await allocateWithRotation(
            candidates, pitch.id, daySlots, occupiedSlots[pitch.id], date, client
          );

          for (const { fixture, kickOff } of allocated) {
            const camera = overrideFor(fixture.home_team)?.default_camera || null;
            const result = await client.query(
              `INSERT INTO allocations (fixture_id, pitch_id, allocated_kick_off, status, week_start, camera)
               VALUES ($1, $2, $3, 'draft', $4, $5) RETURNING id`,
              [fixture.id, pitch.id, kickOff, weekStart, camera]
            );

            await client.query(
              `INSERT INTO allocation_history (team_name, pitch_id, kick_off, match_date)
               VALUES ($1, $2, $3, $4)`,
              [fixture.home_team, pitch.id, kickOff, date]
            );

            occupiedSlots[pitch.id].push(kickOff);
            allocatedIds.add(fixture.id);
            allAllocations.push({ id: result.rows[0].id, fixture, pitch, kick_off: kickOff });
          }
        };

        // Pass 1: honour each team's home-venue preference where possible
        for (const pitch of matchingPitches) {
          const candidates = formatFixtures.filter(
            f => !allocatedIds.has(f.id) && overrideFor(f.home_team)?.home_venue_id === pitch.venue_id
          );
          await fillPitch(candidates, pitch);
        }

        // Pass 2: place everyone still unallocated on any matching pitch
        for (const pitch of matchingPitches) {
          const candidates = formatFixtures.filter(f => !allocatedIds.has(f.id));
          await fillPitch(candidates, pitch);
        }

        // Anything left is a conflict
        formatFixtures
          .filter(f => !allocatedIds.has(f.id))
          .forEach(f => conflicts.push({
            fixture: f,
            reason: `All ${reqFormat} slots full on ${dayOfWeek} ${date}`,
          }));
      }
    }

    console.log(`Allocated: ${allAllocations.length}, Conflicts: ${conflicts.length}`);
    return { allocated: allAllocations.length, allocations: allAllocations, conflicts };

  } finally {
    client.release();
  }
}

/**
 * Get the full allocation grid for a given week
 * This is the data that renders the visual grid (replacing Guy's spreadsheets)
 */
async function getAllocationGrid(weekStartDate) {
  const weekStart = weekStartDate || format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const weekEnd = format(addDays(new Date(weekStart), 6), 'yyyy-MM-dd');

  const result = await pool.query(
    `SELECT 
       a.id as allocation_id,
       a.allocated_kick_off,
       a.status,
       a.camera,
       a.notes,
       f.match_date,
       f.home_team,
       f.away_team,
       f.age_group,
       f.format,
       f.gender,
       f.match_type,
       f.league_code,
       p.name as pitch_name,
       p.format as pitch_format,
       v.name as venue_name,
       r.name as referee_name,
       rc.referee_id as referee_id,
       rc.status as ref_claim_status
     FROM allocations a
     JOIN fixtures f ON f.id = a.fixture_id
     JOIN pitches p ON p.id = a.pitch_id
     JOIN venues v ON v.id = p.venue_id
     LEFT JOIN referee_claims rc ON rc.allocation_id = a.id
     LEFT JOIN referees r ON r.id = rc.referee_id
     WHERE f.match_date BETWEEN $1 AND $2
     ORDER BY v.name, p.format, f.match_date, a.allocated_kick_off`,
    [weekStart, weekEnd]
  );

  // Group by venue > pitch > date for the grid view
  const grid = {};
  
  for (const row of result.rows) {
    const venue = row.venue_name;
    const pitch = row.pitch_name;
    const date = format(new Date(row.match_date), 'yyyy-MM-dd');

    if (!grid[venue]) grid[venue] = {};
    if (!grid[venue][pitch]) grid[venue][pitch] = {};
    if (!grid[venue][pitch][date]) grid[venue][pitch][date] = [];

    grid[venue][pitch][date].push({
      allocation_id: row.allocation_id,
      kick_off: row.allocated_kick_off,
      home_team: row.home_team,
      away_team: row.away_team,
      age_group: row.age_group,
      format: row.format,
      gender: row.gender,
      match_type: row.match_type,
      referee: row.referee_name,
      referee_id: row.referee_id,
      ref_status: row.ref_claim_status,
      camera: row.camera,
      status: row.status,
      notes: row.notes
    });
  }

  return { weekStart, weekEnd, grid, totalAllocations: result.rows.length };
}

/**
 * Get summary stats for WhatsApp message
 */
async function getWeekSummary(weekStartDate) {
  const weekStart = weekStartDate || format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const weekEnd = format(addDays(new Date(weekStart), 6), 'yyyy-MM-dd');

  const stats = await pool.query(
    `SELECT 
       v.name as venue,
       COUNT(a.id) as total_games,
       COUNT(rc.id) as refs_claimed,
       COUNT(a.id) - COUNT(rc.id) as refs_needed
     FROM allocations a
     JOIN fixtures f ON f.id = a.fixture_id
     JOIN pitches p ON p.id = a.pitch_id
     JOIN venues v ON v.id = p.venue_id
     LEFT JOIN referee_claims rc ON rc.allocation_id = a.id
     WHERE f.match_date BETWEEN $1 AND $2
     GROUP BY v.name`,
    [weekStart, weekEnd]
  );

  const unrefed = await pool.query(
    `SELECT 
       a.id, a.allocated_kick_off, f.match_date, f.home_team, f.away_team, f.age_group,
       p.name as pitch_name, v.name as venue_name
     FROM allocations a
     JOIN fixtures f ON f.id = a.fixture_id
     JOIN pitches p ON p.id = a.pitch_id
     JOIN venues v ON v.id = p.venue_id
     LEFT JOIN referee_claims rc ON rc.allocation_id = a.id
     WHERE f.match_date BETWEEN $1 AND $2 AND rc.id IS NULL
     ORDER BY f.match_date, a.allocated_kick_off`,
    [weekStart, weekEnd]
  );

  return {
    weekStart,
    weekEnd,
    venues: stats.rows,
    unrefereed: unrefed.rows
  };
}

module.exports = { allocateFixtures, getAllocationGrid, getWeekSummary };

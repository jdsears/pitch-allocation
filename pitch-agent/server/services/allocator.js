const pool = require('../db/pool');
const { format, startOfWeek, addDays } = require('date-fns');

// Canonical format mapping — recompute at allocation time so we never
// trust stale/incorrect format values stored in the fixtures table.
const AGE_TO_FORMAT = {
  U6: '5v5', U7: '5v5', U8: '5v5', U9: '7v7', U10: '7v7',
  U11: '9v9', U12: '9v9', U13: '11v11', U14: '11v11', U15: '11v11',
  U16: '11v11', U17: '11v11', U18: '11v11'
};
const GIRLS_AGE_TO_FORMAT = {
  ...AGE_TO_FORMAT, U9: '5v5', U11: '7v7', U13: '9v9', U14: '9v9'
};
function computeFormat(ageGroup, gender) {
  const map = gender === 'girls' ? GIRLS_AGE_TO_FORMAT : AGE_TO_FORMAT;
  return map[ageGroup] || '11v11';
}

/**
 * Safely convert a date value (Date object or string) to a YYYY-MM-DD string.
 * Uses local-time getters to avoid timezone-related off-by-one issues
 * that occur with format(new Date(...)) or toISOString().
 * Returns null if the value is missing or invalid.
 */
function toDateString(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const str = String(value);
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[0] : null;
}

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
 * Extract numeric age from age group string (e.g. "U13" → 13, "U9" → 9).
 * Returns null if the string doesn't match.
 */
function ageGroupNumber(ageGroup) {
  if (!ageGroup) return null;
  const m = String(ageGroup).match(/U(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
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

    // Clear existing DRAFT allocations for this week so we can re-allocate
    // with current rules. Confirmed allocations are left untouched.
    const cleared = await client.query(
      `DELETE FROM allocations
       WHERE status = 'draft'
       AND fixture_id IN (
         SELECT f.id FROM fixtures f
         WHERE f.match_date BETWEEN $1 AND $2
       )`,
      [weekStart, weekEnd]
    );
    if (cleared.rowCount > 0) {
      console.log(`Cleared ${cleared.rowCount} draft allocations for re-allocation`);
    }

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

    const allAllocations = [];
    const conflicts = [];

    // Group fixtures by date
    const fixturesByDate = {};
    for (const fixture of fixtures.rows) {
      const date = toDateString(fixture.match_date);
      if (!date) continue; // skip fixtures with invalid/missing dates
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
      // Always recompute format from gender + age_group to avoid stale DB values
      const byFormat = {};
      for (const f of dateFixtures) {
        const reqFormat = computeFormat(f.age_group, f.gender);
        if (reqFormat !== f.format) {
          console.log(`Format correction: ${f.home_team} (${f.gender} ${f.age_group}): DB has ${f.format}, using ${reqFormat}`);
          f.format = reqFormat;
          // Also fix it in the DB while we're at it
          client.query('UPDATE fixtures SET format = $1 WHERE id = $2', [reqFormat, f.id]).catch(() => {});
        }
        if (!byFormat[reqFormat]) byFormat[reqFormat] = [];
        byFormat[reqFormat].push(f);
      }

      // Allocate each format group to matching pitches
      for (const [reqFormat, formatFixtures] of Object.entries(byFormat)) {
        const allMatchingPitches = pitches.rows.filter(p => p.format === reqFormat);

        if (allMatchingPitches.length === 0) {
          formatFixtures.forEach(f => conflicts.push({ fixture: f, reason: `No pitch for format ${reqFormat}` }));
          continue;
        }

        // Helper: check if a fixture's age group fits a pitch's age restrictions
        const fitsPitch = (fixture, pitch) => {
          const fixtureAge = ageGroupNumber(fixture.age_group);
          if (!fixtureAge) return true; // can't determine age, allow
          if (pitch.max_age_group) {
            const maxAge = ageGroupNumber(pitch.max_age_group);
            if (maxAge && fixtureAge > maxAge) return false;
          }
          if (pitch.min_age_group) {
            const minAge = ageGroupNumber(pitch.min_age_group);
            if (minAge && fixtureAge < minAge) return false;
          }
          return true;
        };

        // Split fixtures: those that exceed restricted pitches go first (to unrestricted only)
        const needsUnrestricted = [];
        const fitsRestricted = [];
        for (const f of formatFixtures) {
          const hasEligibleRestricted = allMatchingPitches.some(p => p.max_age_group && fitsPitch(f, p));
          if (hasEligibleRestricted) {
            fitsRestricted.push(f);
          } else {
            needsUnrestricted.push(f);
          }
        }

        const unrestrictedPitches = allMatchingPitches.filter(p => !p.max_age_group);
        const restrictedPitches = allMatchingPitches.filter(p => p.max_age_group);

        // Phase 1: Allocate fixtures that need unrestricted pitches (e.g. U15/U16 → Morley only)
        let remaining = [...needsUnrestricted];

        for (const pitch of unrestrictedPitches) {
          if (remaining.length === 0) break;
          if (!occupiedSlots[pitch.id]) occupiedSlots[pitch.id] = [];

          const daySlots = await getSlotsForPitchDay(pitch.id, dayOfWeek);
          if (daySlots.length === 0) continue;

          const { allocated, overflow } = await allocateWithRotation(
            remaining, pitch.id, daySlots, occupiedSlots[pitch.id], date, client
          );

          for (const { fixture, kickOff } of allocated) {
            const result = await client.query(
              `INSERT INTO allocations (fixture_id, pitch_id, allocated_kick_off, status, week_start)
               VALUES ($1, $2, $3, 'draft', $4) RETURNING id`,
              [fixture.id, pitch.id, kickOff, weekStart]
            );

            await client.query(
              `INSERT INTO allocation_history (team_name, pitch_id, kick_off, match_date)
               VALUES ($1, $2, $3, $4)`,
              [fixture.home_team, pitch.id, kickOff, date]
            );

            occupiedSlots[pitch.id].push(kickOff);
            allAllocations.push({ id: result.rows[0].id, fixture, pitch, kick_off: kickOff });
          }

          remaining = overflow;
        }

        // Phase 2: Allocate fixtures that fit restricted pitches (e.g. U13/U14 → Shropham OK)
        // Try restricted pitches first, then overflow to unrestricted
        remaining = [...remaining, ...fitsRestricted];

        for (const pitch of [...restrictedPitches, ...unrestrictedPitches]) {
          if (remaining.length === 0) break;
          if (!occupiedSlots[pitch.id]) occupiedSlots[pitch.id] = [];

          // Filter remaining to only those that fit this pitch
          const eligible = remaining.filter(f => fitsPitch(f, pitch));
          const ineligible = remaining.filter(f => !fitsPitch(f, pitch));
          if (eligible.length === 0) continue;

          const daySlots = await getSlotsForPitchDay(pitch.id, dayOfWeek);
          if (daySlots.length === 0) continue;

          const { allocated, overflow } = await allocateWithRotation(
            eligible, pitch.id, daySlots, occupiedSlots[pitch.id], date, client
          );

          for (const { fixture, kickOff } of allocated) {
            const result = await client.query(
              `INSERT INTO allocations (fixture_id, pitch_id, allocated_kick_off, status, week_start)
               VALUES ($1, $2, $3, 'draft', $4) RETURNING id`,
              [fixture.id, pitch.id, kickOff, weekStart]
            );

            await client.query(
              `INSERT INTO allocation_history (team_name, pitch_id, kick_off, match_date)
               VALUES ($1, $2, $3, $4)`,
              [fixture.home_team, pitch.id, kickOff, date]
            );

            occupiedSlots[pitch.id].push(kickOff);
            allAllocations.push({ id: result.rows[0].id, fixture, pitch, kick_off: kickOff });
          }

          remaining = [...overflow, ...ineligible];
        }

        // Anything left is a conflict
        remaining.forEach(f => conflicts.push({
          fixture: f,
          reason: `All ${reqFormat} slots full on ${dayOfWeek} ${date}`
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
    const date = toDateString(row.match_date);
    if (!date) continue; // skip rows with invalid/missing dates

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

/**
 * Get a multi-week overview of allocations (rolling N weeks from a start date)
 */
async function getMultiWeekOverview(startDate, numWeeks = 4) {
  const weekStart = startDate || format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const overviewEnd = format(addDays(new Date(weekStart), numWeeks * 7 - 1), 'yyyy-MM-dd');

  const result = await pool.query(
    `SELECT
       a.id as allocation_id,
       a.allocated_kick_off,
       a.status,
       a.camera,
       a.notes,
       a.week_start,
       f.match_date,
       f.home_team,
       f.away_team,
       f.age_group,
       f.format,
       f.gender,
       f.kick_off as fixture_kick_off,
       p.name as pitch_name,
       p.format as pitch_format,
       v.name as venue_name,
       r.name as referee_name,
       rc.referee_id,
       rc.status as ref_claim_status
     FROM allocations a
     JOIN fixtures f ON f.id = a.fixture_id
     JOIN pitches p ON p.id = a.pitch_id
     JOIN venues v ON v.id = p.venue_id
     LEFT JOIN referee_claims rc ON rc.allocation_id = a.id
     LEFT JOIN referees r ON r.id = rc.referee_id
     WHERE f.match_date BETWEEN $1 AND $2
     ORDER BY f.match_date, a.allocated_kick_off, v.name`,
    [weekStart, overviewEnd]
  );

  // Also fetch unallocated home fixtures for the same range
  const unallocated = await pool.query(
    `SELECT f.* FROM fixtures f
     LEFT JOIN allocations a ON a.fixture_id = f.id
     WHERE f.is_home_game = true
     AND f.match_date BETWEEN $1 AND $2
     AND a.id IS NULL
     ORDER BY f.match_date, f.kick_off`,
    [weekStart, overviewEnd]
  );

  // Group allocations by week
  const weeks = [];
  for (let w = 0; w < numWeeks; w++) {
    const ws = format(addDays(new Date(weekStart), w * 7), 'yyyy-MM-dd');
    const we = format(addDays(new Date(weekStart), w * 7 + 6), 'yyyy-MM-dd');

    const weekAllocations = result.rows.filter(r => {
      const d = toDateString(r.match_date);
      return d && d >= ws && d <= we;
    });

    const weekUnallocated = unallocated.rows.filter(r => {
      const d = toDateString(r.match_date);
      return d && d >= ws && d <= we;
    });

    const totalGames = weekAllocations.length;
    const refsAssigned = weekAllocations.filter(a => a.referee_name).length;

    weeks.push({
      weekStart: ws,
      weekEnd: we,
      allocations: weekAllocations.map(row => ({
        allocation_id: row.allocation_id,
        kick_off: row.allocated_kick_off,
        match_date: toDateString(row.match_date),
        home_team: row.home_team,
        away_team: row.away_team,
        age_group: row.age_group,
        format: row.format,
        gender: row.gender,
        venue_name: row.venue_name,
        pitch_name: row.pitch_name,
        referee: row.referee_name,
        camera: row.camera,
        status: row.status,
      })),
      unallocated: weekUnallocated.length,
      totalGames,
      refsAssigned,
      refsNeeded: totalGames - refsAssigned,
    });
  }

  return { weekStart, overviewEnd, weeks };
}

module.exports = { allocateFixtures, getAllocationGrid, getWeekSummary, getMultiWeekOverview };

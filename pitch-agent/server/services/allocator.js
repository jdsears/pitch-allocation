const pool = require('../db/pool');
const { format, startOfWeek, addDays } = require('date-fns');

// Canonical format mapping — recompute at allocation time so we never
// trust stale/incorrect format values stored in the fixtures table.
const { computeFormat } = require('../lib/formats');
const {
  loadClosure, isClosedOn, isHostPitch, overlayFor, partnerIds, closureSlots,
  ensureOverlayPitches, isJunior11, CLOSED_VENUE, OVERLAY_PITCHES,
} = require('../lib/shrophamClosure');

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
 * Returns fixtures in priority order: teams with no history first, then
 * whoever kicked off LATEST last time (they get the earliest slot now).
 */
async function rotationOrder(fixtures, pitchId) {
  const withHistory = await Promise.all(
    fixtures.map(async (f) => ({ fixture: f, lastKO: await getLastKickOff(f.home_team, pitchId) }))
  );
  withHistory.sort((a, b) => {
    if (!a.lastKO && !b.lastKO) return 0;
    if (!a.lastKO) return -1;
    if (!b.lastKO) return 1;
    return a.lastKO < b.lastKO ? 1 : -1;
  });
  return withHistory.map(h => h.fixture);
}

/**
 * Main allocation function.
 *
 * opts.closure  — Shropham closure settings to use instead of the saved ones
 * opts.dryRun   — do everything in a transaction, report, then roll back
 */
async function allocateFixtures(weekStartDate, opts = {}) {
  const client = await pool.connect();

  try {
    // Whole run is one transaction: a mid-run failure can't leave the week
    // half-allocated with the old drafts already deleted.
    await client.query('BEGIN');
    const weekStart = weekStartDate || format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const weekEnd = format(addDays(new Date(weekStart), 6), 'yyyy-MM-dd');

    console.log(`Allocating fixtures for week: ${weekStart} to ${weekEnd}${opts.dryRun ? ' (preview)' : ''}`);

    const closure = opts.closure || await loadClosure(client);
    const closedOn = (date) => isClosedOn(closure, date);
    // Allocations last touched before the switch was turned on were made
    // under the normal rules; in a preview, everything existing counts as old
    const closureSince = opts.closure ? new Date() : new Date(closure.enabled_at || 0);
    const weekDates = [...Array(7)].map((_, i) => format(addDays(new Date(weekStart), i), 'yyyy-MM-dd'));
    const anyClosed = weekDates.some(closedOn);
    if (anyClosed) {
      console.log(`Shropham closed on ${weekDates.filter(closedOn).join(', ')} — Morley-only plan`);
      await ensureOverlayPitches(client);
    }

    // Clear existing DRAFT allocations for this week so we can re-allocate
    // with current rules. Confirmed allocations and drafts with referee
    // claims are left untouched (refs already committed to those slots).
    const cleared = await client.query(
      `DELETE FROM allocations
       WHERE status = 'draft'
       AND fixture_id IN (
         SELECT f.id FROM fixtures f
         WHERE f.match_date BETWEEN $1 AND $2
       )
       AND id NOT IN (SELECT allocation_id FROM referee_claims)`,
      [weekStart, weekEnd]
    );
    if (cleared.rowCount > 0) {
      console.log(`Cleared ${cleared.rowCount} draft allocations for re-allocation`);
    }

    // Get all pitches with venue info
    const pitches = await client.query(
      `SELECT p.*, v.name as venue_name FROM pitches p
       JOIN venues v ON v.id = p.venue_id
       ORDER BY v.name, p.format`
    );
    const pitchById = Object.fromEntries(pitches.rows.map(p => [p.id, p]));

    // On closure dates, games that are still at Shropham — or at a Morley
    // time that isn't in the plan and was set before the switch went on —
    // are re-placed. The allocation row is updated in place so any referee
    // claim stays with the game.
    const moving = {}; // fixture_id -> { allocation_id, from }
    if (anyClosed) {
      const placed = await client.query(
        `SELECT a.id, a.fixture_id, a.pitch_id, a.allocated_kick_off, a.updated_at, f.match_date
           FROM allocations a JOIN fixtures f ON f.id = a.fixture_id
          WHERE f.match_date BETWEEN $1 AND $2`,
        [weekStart, weekEnd]
      );
      for (const a of placed.rows) {
        const date = toDateString(a.match_date);
        const pitch = pitchById[a.pitch_id];
        if (!date || !pitch || !closedOn(date)) continue;
        let outOfPlan = !isHostPitch(pitch);
        if (!outOfPlan) {
          const day = getDayOfWeek(date);
          const slots = closureSlots(closure, pitch, day, await getSlotsForPitchDay(pitch.id, day));
          outOfPlan = !slots.includes(a.allocated_kick_off) && new Date(a.updated_at) < closureSince;
        }
        if (outOfPlan) {
          moving[a.fixture_id] = {
            allocation_id: a.id,
            from: `${pitch.venue_name} ${pitch.name} ${String(a.allocated_kick_off).slice(0, 5)}`,
          };
        }
      }
      if (Object.keys(moving).length) console.log(`${Object.keys(moving).length} allocation(s) need moving into the Morley-only plan`);
    }

    // Home fixtures for this week that aren't yet allocated, plus any being moved
    const fixtures = await client.query(
      `SELECT f.* FROM fixtures f 
       LEFT JOIN allocations a ON a.fixture_id = f.id 
       WHERE f.is_home_game = true 
       AND f.match_date BETWEEN $1 AND $2 
       AND a.id IS NULL
       ORDER BY f.match_date, f.kick_off`,
      [weekStart, weekEnd]
    );
    const toPlace = [...fixtures.rows];
    const movingIds = Object.keys(moving).map(Number);
    if (movingIds.length) {
      const movingFixtures = await client.query(`SELECT * FROM fixtures WHERE id = ANY($1::int[])`, [movingIds]);
      for (const f of movingFixtures.rows) {
        toPlace.push({ ...f, reuse_allocation_id: moving[f.id].allocation_id, moved_from: moving[f.id].from });
      }
    }

    if (toPlace.length === 0) {
      console.log('No unallocated home fixtures for this week');
      const games = opts.dryRun ? await placedGames(client, weekStart, weekEnd) : undefined;
      await client.query(opts.dryRun ? 'ROLLBACK' : 'COMMIT');
      return { allocated: 0, moved: 0, conflicts: [], games };
    }

    console.log(`Found ${toPlace.length} home fixtures to allocate`);
    for (const f of toPlace) {
      console.log(`  Fixture #${f.id}: ${f.home_team} vs ${f.away_team} (${f.gender} ${f.age_group}, format=${f.format}, date=${toDateString(f.match_date)})${f.moved_from ? ` — moving from ${f.moved_from}` : ''}`);
    }

    console.log(`Available pitches: ${pitches.rows.map(p => `${p.venue_name} ${p.name} (${p.format})`).join(', ')}`);

    // Active managed teams, keyed by lowercased name, for per-team overrides:
    // explicit format exception, default camera, and home-venue preference.
    // A home-venue preference is tried first (Phase 0) and also overrides the
    // age-based pitch restrictions at that venue — e.g. a U14 side set to
    // Morley may use its full-size pitch instead of going to Shropham.
    const teamMap = {};
    try {
      const teamRows = await client.query(`SELECT name, format, default_camera, home_venue_id FROM teams WHERE active = true`);
      for (const t of teamRows.rows) teamMap[(t.name || '').trim().toLowerCase()] = t;
    } catch (e) {
      // teams table/columns may not exist on a fresh DB — overrides just don't apply
    }
    const teamFor = (homeTeam) => teamMap[(homeTeam || '').trim().toLowerCase()];

    const allAllocations = [];
    const conflicts = [];
    let moved = 0;

    // Group fixtures by date
    const fixturesByDate = {};
    for (const fixture of toPlace) {
      const date = toDateString(fixture.match_date);
      if (!date) continue; // skip fixtures with invalid/missing dates
      if (!fixturesByDate[date]) fixturesByDate[date] = [];
      fixturesByDate[date].push(fixture);
    }

    for (const [date, dateFixtures] of Object.entries(fixturesByDate)) {
      const dayOfWeek = getDayOfWeek(date);
      const closed = closedOn(date);
      // Closure: Morley pitches only (incl. the extra 9v9 markings).
      // Normal: every pitch except those closure-only 9v9 markings.
      const datePitches = pitches.rows.filter(p => (closed ? isHostPitch(p) : !overlayFor(p)));

      // Track occupied slots per pitch for this date, and (closure) how many
      // games kick off at each time across Morley, to spread arrivals
      const occupiedSlots = {};
      const koLoad = {};
      const existing = await client.query(
        `SELECT a.fixture_id, a.pitch_id, a.allocated_kick_off FROM allocations a
         JOIN fixtures f ON f.id = a.fixture_id
         WHERE f.match_date = $1`,
        [date]
      );
      for (const row of existing.rows) {
        if (moving[row.fixture_id]) continue;
        if (!occupiedSlots[row.pitch_id]) occupiedSlots[row.pitch_id] = [];
        occupiedSlots[row.pitch_id].push(row.allocated_kick_off);
        if (closed && pitchById[row.pitch_id] && isHostPitch(pitchById[row.pitch_id])) {
          koLoad[row.allocated_kick_off] = (koLoad[row.allocated_kick_off] || 0) + 1;
        }
      }

      const place = async (fixture, pitch, kickOff) => {
        let id;
        if (fixture.reuse_allocation_id) {
          await client.query(
            `UPDATE allocations SET pitch_id = $1, allocated_kick_off = $2, status = 'draft', updated_at = NOW()
             WHERE id = $3`,
            [pitch.id, kickOff, fixture.reuse_allocation_id]
          );
          id = fixture.reuse_allocation_id;
          moved++;
        } else {
          const result = await client.query(
            `INSERT INTO allocations (fixture_id, pitch_id, allocated_kick_off, status, week_start)
             VALUES ($1, $2, $3, 'draft', $4) RETURNING id`,
            [fixture.id, pitch.id, kickOff, weekStart]
          );
          id = result.rows[0].id;
        }
        await client.query(
          `INSERT INTO allocation_history (team_name, pitch_id, kick_off, match_date)
           VALUES ($1, $2, $3, $4)`,
          [fixture.home_team, pitch.id, kickOff, date]
        );
        if (!occupiedSlots[pitch.id]) occupiedSlots[pitch.id] = [];
        occupiedSlots[pitch.id].push(kickOff);
        if (closed) koLoad[kickOff] = (koLoad[kickOff] || 0) + 1;
        allAllocations.push({ id, fixture, pitch, kick_off: kickOff, moved_from: fixture.moved_from || null });
      };

      // Place as many of `list` as fit on `pitch`; returns the overflow
      const tryPitch = async (pitch, list, label) => {
        if (list.length === 0) return list;
        const standard = await getSlotsForPitchDay(pitch.id, dayOfWeek);
        const daySlots = closed ? closureSlots(closure, pitch, dayOfWeek, standard) : standard;
        // A 9v9 marked over another pitch shares its space: either one in use blocks the other
        const space = [pitch.id, ...(closed ? partnerIds(pitch, dayOfWeek, datePitches) : [])];
        const blocked = space.flatMap(id => occupiedSlots[id] || []);
        let free = daySlots.filter(s => !blocked.includes(s));
        console.log(`  ${label}: ${pitch.venue_name} ${pitch.name} (id=${pitch.id}) — ${dayOfWeek} slots: ${daySlots.join(', ') || 'NONE'}, free: ${free.join(', ') || 'none'}, fixtures: ${list.length}`);
        if (free.length === 0) return list;

        if (closed && free.length > list.length) {
          // Spread arrivals for parking: use the least-busy kick-offs at Morley
          free = [...free]
            .sort((a, b) => (koLoad[a] || 0) - (koLoad[b] || 0) || a.localeCompare(b))
            .slice(0, list.length)
            .sort();
        }

        const ordered = await rotationOrder(list, pitch.id);
        let placing = ordered.slice(0, free.length);
        const overflow = ordered.slice(free.length);

        if (closed && pitch.format === '11v11' && !overlayFor(pitch)) {
          // Group U14 (junior goals) at one end of the day so the goals
          // only get swapped once; rotation still decides who gets a slot
          const juniors = placing.filter(f => isJunior11(f.age_group));
          const seniors = placing.filter(f => !isJunior11(f.age_group));
          placing = closure.junior_goals === 'last' ? [...seniors, ...juniors] : [...juniors, ...seniors];
        }

        for (let i = 0; i < placing.length; i++) await place(placing[i], pitch, free[i]);
        return overflow;
      };

      // Group this day's fixtures by required format (pitch type)
      // Recompute format from gender + age_group UNLESS the user manually overrode it
      const byFormat = {};
      for (const f of dateFixtures) {
        let reqFormat;
        const team = teamFor(f.home_team);
        if (f.format_override && f.format) {
          // User manually set the format (e.g. changed a friendly to 7v7) — respect it
          reqFormat = f.format;
          console.log(`Format override respected: ${f.home_team} (${f.gender} ${f.age_group}): using manual ${reqFormat}`);
        } else if (team && team.format) {
          // Team has an explicit format exception configured in Team management
          reqFormat = team.format;
          if (reqFormat !== f.format) {
            f.format = reqFormat;
            await client.query('UPDATE fixtures SET format = $1 WHERE id = $2', [reqFormat, f.id]);
          }
          console.log(`Team format exception: ${f.home_team} using ${reqFormat}`);
        } else {
          reqFormat = computeFormat(f.age_group, f.gender);
          if (reqFormat !== f.format) {
            console.log(`Format correction: ${f.home_team} (${f.gender} ${f.age_group}): DB has ${f.format}, using ${reqFormat}`);
            f.format = reqFormat;
            // Also fix it in the DB while we're at it
            await client.query('UPDATE fixtures SET format = $1 WHERE id = $2', [reqFormat, f.id]);
          }
        }
        if (!byFormat[reqFormat]) byFormat[reqFormat] = [];
        byFormat[reqFormat].push(f);
      }

      // Allocate each format group to matching pitches
      for (const [reqFormat, formatFixtures] of Object.entries(byFormat)) {
        const allMatchingPitches = datePitches.filter(p => p.format === reqFormat);
        console.log(`${dayOfWeek} ${date}: ${formatFixtures.length} fixture(s) need ${reqFormat}, ${allMatchingPitches.length} pitch(es) match: ${allMatchingPitches.map(p => `${p.venue_name} ${p.name} (id=${p.id})`).join(', ') || 'NONE'}`);

        const conflictReason = (f, fallback) => (f.moved_from
          ? `No room at Morley on ${dayOfWeek} ${date} — still at ${f.moved_from}`
          : fallback);

        if (allMatchingPitches.length === 0) {
          formatFixtures.forEach(f => conflicts.push({ fixture: f, reason: conflictReason(f, `No pitch for format ${reqFormat}`) }));
          continue;
        }

        // Helper: check if a fixture's age group fits a pitch's age restrictions
        const fitsPitch = (fixture, pitch) => {
          // Closure: everything is at Morley and junior goals let U14 use
          // the full-size 11v11, so age limits don't apply
          if (closed) return true;
          // An explicit team home-venue preference overrides age restrictions
          // at that venue (e.g. a U14 side set to Morley may use its full-size
          // pitch rather than being forced to Shropham)
          const team = teamFor(fixture.home_team);
          if (team && team.home_venue_id && team.home_venue_id === pitch.venue_id) return true;
          // Unknown age (e.g. VETS — adult teams carry no U-number) means
          // ADULT: too old for max-age junior pitches (Shropham 11v11),
          // fine for min-age full-size pitches (Morley 11v11).
          const fixtureAge = ageGroupNumber(fixture.age_group) ?? 99;
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
          remaining = await tryPitch(pitch, remaining, 'Phase 1');
        }

        remaining = [...remaining, ...fitsRestricted];

        // Phase 1.5: home-venue preference. Teams with an explicit home venue
        // set in Team management get first pick of that venue's matching
        // pitches (the preference also lifts age limits there — see fitsPitch,
        // e.g. a U14 side set to Morley may use its full-size pitch). This
        // runs AFTER Phase 1 so fixtures with no alternative venue are never
        // starved of their only slots; if the preferred venue is full the
        // fixture falls through to the normal flow below.
        let withPref = remaining.filter(f => {
          const t = teamFor(f.home_team);
          return t && t.home_venue_id && allMatchingPitches.some(p => p.venue_id === t.home_venue_id);
        });
        if (withPref.length > 0) {
          remaining = remaining.filter(f => !withPref.includes(f));
          for (const pitch of allMatchingPitches) {
            if (withPref.length === 0) break;
            const eligible = withPref.filter(f => teamFor(f.home_team).home_venue_id === pitch.venue_id);
            if (eligible.length === 0) continue;
            const overflow = await tryPitch(pitch, eligible, 'Phase 1.5 (home-venue preference)');
            withPref = [...overflow, ...withPref.filter(f => !eligible.includes(f))];
          }
          // Preference couldn't be honoured (venue full / no slots) — the
          // normal flow below places these fixtures anywhere suitable
          remaining = [...remaining, ...withPref];
        }

        // Phase 2: Allocate fixtures that fit restricted pitches (e.g. U13/U14 → Shropham OK)
        // Try restricted pitches first, then overflow to unrestricted
        for (const pitch of [...restrictedPitches, ...unrestrictedPitches]) {
          if (remaining.length === 0) break;
          const eligible = remaining.filter(f => fitsPitch(f, pitch));
          const ineligible = remaining.filter(f => !fitsPitch(f, pitch));
          if (eligible.length === 0) continue;
          const overflow = await tryPitch(pitch, eligible, 'Phase 2');
          remaining = [...overflow, ...ineligible];
        }

        // Anything left is a conflict
        const shared = closed && OVERLAY_PITCHES.find(o => o.day === dayOfWeek && (o.format === reqFormat || o.over === reqFormat));
        const sharedNote = shared ? ` (the ${shared.format} is marked over the ${shared.over}, so they share kick-offs)` : '';
        remaining.forEach(f => conflicts.push({
          fixture: f,
          reason: conflictReason(f, `All ${reqFormat} slots full on ${dayOfWeek} ${date}${sharedNote}`),
        }));
      }
    }

    // Pre-fill the default camera for any draft allocation whose home team has
    // one configured and that doesn't already have a camera set. Single safe
    // post-pass — doesn't touch the slot/rotation logic above.
    try {
      const cam = await client.query(
        `UPDATE allocations a
            SET camera = t.default_camera
           FROM fixtures f, teams t
          WHERE a.fixture_id = f.id
            AND a.week_start = $1
            AND (a.camera IS NULL OR a.camera = '')
            AND a.status = 'draft'
            AND t.active = true
            AND t.default_camera IS NOT NULL AND t.default_camera <> ''
            AND lower(trim(f.home_team)) = lower(trim(t.name))`,
        [weekStart]
      );
      if (cam.rowCount > 0) console.log(`Pre-filled default camera on ${cam.rowCount} allocation(s)`);
    } catch (e) {
      // teams table/columns may not exist yet — skip camera pre-fill
    }

    console.log(`Allocated: ${allAllocations.length} (moved ${moved}), Conflicts: ${conflicts.length}`);
    if (opts.dryRun) {
      const games = await placedGames(client, weekStart, weekEnd);
      await client.query('ROLLBACK');
      return { allocated: allAllocations.length, moved, conflicts, games };
    }
    await client.query('COMMIT');
    return { allocated: allAllocations.length, moved, allocations: allAllocations, conflicts };

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Every game placed in the week, for previews (read inside the transaction). */
async function placedGames(client, weekStart, weekEnd) {
  const r = await client.query(
    `SELECT f.match_date, a.allocated_kick_off, f.home_team, f.away_team, f.age_group,
            p.name AS pitch_name, p.format AS pitch_format, v.name AS venue_name
       FROM allocations a
       JOIN fixtures f ON f.id = a.fixture_id
       JOIN pitches p ON p.id = a.pitch_id
       JOIN venues v ON v.id = p.venue_id
      WHERE f.match_date BETWEEN $1 AND $2
      ORDER BY f.match_date, a.allocated_kick_off, p.name`,
    [weekStart, weekEnd]
  );
  return r.rows.map(g => ({ ...g, match_date: toDateString(g.match_date) }));
}

const isoAddDays = (dateStr, n) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
};
const isoMonday = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return isoAddDays(dateStr, -dow);
};

/**
 * Practice run of the Morley-only plan over the closure window (or 8 weeks
 * if open-ended, max 12): runs the real allocator per week in a rolled-back
 * transaction and reports, per closure date, the kick-off spread and anything
 * that wouldn't fit. Nothing is saved.
 */
async function previewClosure(closure) {
  const plan = { ...closure, enabled: true };
  const last = plan.to || isoAddDays(plan.from, 8 * 7 - 1);
  const days = [];
  for (let ws = isoMonday(plan.from), n = 0; ws <= last && n < 12; ws = isoAddDays(ws, 7), n++) {
    const res = await allocateFixtures(ws, { closure: plan, dryRun: true });
    for (let i = 0; i < 7; i++) {
      const date = isoAddDays(ws, i);
      if (!isClosedOn(plan, date)) continue;
      const games = (res.games || []).filter(g => g.match_date === date);
      const conflicts = res.conflicts
        .filter(c => toDateString(c.fixture.match_date) === date)
        .map(c => ({
          home_team: c.fixture.home_team, away_team: c.fixture.away_team,
          age_group: c.fixture.age_group, format: c.fixture.format, reason: c.reason,
        }));
      if (games.length === 0 && conflicts.length === 0) continue;
      const kickOffs = {};
      for (const g of games) {
        if ((g.venue_name || '').toLowerCase() === CLOSED_VENUE.toLowerCase()) continue;
        const ko = String(g.allocated_kick_off).slice(0, 5);
        kickOffs[ko] = (kickOffs[ko] || 0) + 1;
      }
      days.push({
        date,
        day: getDayOfWeek(date),
        games: games.map(g => ({
          kick_off: String(g.allocated_kick_off).slice(0, 5),
          pitch: `${g.venue_name} ${g.pitch_name}`,
          home_team: g.home_team, away_team: g.away_team, age_group: g.age_group,
          junior_goals: g.pitch_format === '11v11' && isJunior11(g.age_group),
        })),
        kickOffs,
        stillAtShropham: games.filter(g => (g.venue_name || '').toLowerCase() === CLOSED_VENUE.toLowerCase()).length,
        conflicts,
      });
    }
  }
  return { from: plan.from, to: plan.to, through: last, days };
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
       a.pitch_id,
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
      pitch_id: row.pitch_id,
      pitch_format: row.pitch_format,
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

    const allocationRows = weekAllocations.map(row => ({
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
      pitch_format: row.pitch_format,
      referee: row.referee_name,
      camera: row.camera,
      status: row.status,
    }));

    const unallocatedRows = weekUnallocated.map(row => ({
      allocation_id: null,
      kick_off: row.kick_off,
      match_date: toDateString(row.match_date),
      home_team: row.home_team,
      away_team: row.away_team,
      age_group: row.age_group,
      format: row.format,
      gender: row.gender,
      venue_name: null,
      pitch_name: null,
      referee: null,
      camera: null,
      status: 'unallocated',
    }));

    const combined = [...allocationRows, ...unallocatedRows].sort((a, b) =>
      (a.match_date || '').localeCompare(b.match_date || '') || (a.kick_off || '').localeCompare(b.kick_off || '')
    );

    weeks.push({
      weekStart: ws,
      weekEnd: we,
      allocations: combined,
      unallocated: weekUnallocated.length,
      totalGames: totalGames + weekUnallocated.length,
      refsAssigned,
      refsNeeded: totalGames + weekUnallocated.length - refsAssigned,
    });
  }

  return { weekStart, overviewEnd, weeks };
}

module.exports = { allocateFixtures, previewClosure, getAllocationGrid, getWeekSummary, getMultiWeekOverview };

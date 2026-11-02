/**
 * Shropham closure ("Morley-only plan"): while Shropham is shut for pitch
 * maintenance every home game is played at Morley. Switched on from Admin ▸
 * Venues with a start date (and optional end date); outside that window the
 * normal two-venue rules apply.
 *
 * On a closure date:
 *  - only Morley pitches are used, with the kick-off times below on Sat/Sun
 *  - pitch age limits are lifted: U14 play junior 11v11 on Morley's full-size
 *    pitch using the junior (21x7ft) goals; still one 11v11 game at a time
 *  - 9v9 uses an extra pitch marked out at Morley for the closure only
 *    (its own space, so it runs alongside every other pitch)
 *  - games are spread across the kick-off times to ease parking
 *  - U14 games on the 11v11 are grouped first (or last) in the day so the
 *    junior goals only go up and come down once
 */

const SETTING_KEY = 'shropham_closure';
const CLOSED_VENUE = 'Shropham';
const HOST_VENUE = 'Morley';

const DEFAULTS = {
  enabled: false,
  from: '2026-10-31',
  to: null,
  saturday: ['09:30', '11:00', '12:30'],
  sunday: ['09:30', '12:00', '14:30'],
  junior_goals: 'first',
  enabled_at: null,
};

// NCYFL 26/27 rules M.3 / M.4: earliest and latest kick-off per day
const KO_WINDOWS = { saturday: ['09:30', '12:30'], sunday: ['09:30', '14:30'] };

// Extra Morley pitches that exist only for the closure
const CLOSURE_PITCHES = [{ name: '9v9', format: '9v9' }];
// The first plan marked 9v9 over the 11v11 (Sat) and the 7v7 (Sun); replaced
// by the single standalone 9v9 above
const RETIRED_PITCHES = ['9v9 over 11v11', '9v9 over 7v7'];

/** Junior 11v11 (U14 and under) uses the smaller 21x7ft goals. */
function isJunior11(ageGroup) {
  const m = String(ageGroup || '').match(/U(\d+)/i);
  return !!m && parseInt(m[1], 10) <= 14;
}

/** '9:30' / '09:30' / '09:30:00' → '09:30:00' (pg TIME text form). */
function toTime(value) {
  const m = String(value || '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}:00`;
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());

/**
 * Validate admin input. Returns { value } (normalised, HH:MM times) or { error }.
 */
function validateClosure(input) {
  const v = { ...DEFAULTS, ...(input || {}) };
  const enabled = !!v.enabled;
  const from = v.from || null;
  const to = v.to || null;
  if (enabled && !from) return { error: 'Pick the date the switch to Morley starts' };
  if (from && !isDate(from)) return { error: 'Start date is not a valid date' };
  if (to && !isDate(to)) return { error: 'End date is not a valid date' };
  if (from && to && to < from) return { error: 'End date is before the start date' };

  if (!['first', 'last'].includes(v.junior_goals)) return { error: 'Junior goals must be "first" or "last"' };
  const out = { enabled, from, to, junior_goals: v.junior_goals };
  for (const day of ['saturday', 'sunday']) {
    const list = Array.isArray(v[day]) ? v[day] : String(v[day] || '').split(/[,\s]+/);
    const times = [...new Set(list.filter(Boolean).map(toTime))];
    const label = day[0].toUpperCase() + day.slice(1);
    if (times.length === 0 || times.includes(null)) {
      return { error: `${label} kick-offs must be times like 09:30, 11:00` };
    }
    const [earliest, latest] = KO_WINDOWS[day].map(toTime);
    const outside = times.filter(t => t < earliest || t > latest);
    if (outside.length) {
      return { error: `${label} kick-offs must be between ${KO_WINDOWS[day][0]} and ${KO_WINDOWS[day][1]} (league rules)` };
    }
    out[day] = times.sort().map(t => t.slice(0, 5));
  }
  return { value: out };
}

async function loadClosure(q) {
  try {
    const r = await q.query(`SELECT value FROM app_settings WHERE key = $1`, [SETTING_KEY]);
    return { ...DEFAULTS, ...(r.rows[0]?.value || {}) };
  } catch (e) {
    return { ...DEFAULTS }; // settings table not created yet
  }
}

/** Save validated settings; stamps enabled_at when the switch goes off → on. */
async function saveClosure(q, value) {
  const prev = await loadClosure(q);
  const enabled_at = value.enabled
    ? (prev.enabled && prev.enabled_at ? prev.enabled_at : new Date().toISOString())
    : null;
  const next = { ...value, enabled_at };
  await q.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [SETTING_KEY, JSON.stringify(next)]
  );
  if (value.enabled) await ensureClosurePitches(q);
  return next;
}

function isClosedOn(closure, dateStr) {
  if (!closure || !closure.enabled || !closure.from || !dateStr) return false;
  return dateStr >= closure.from && (!closure.to || dateStr <= closure.to);
}

/** Create the closure-only pitches at Morley (idempotent). Returns the host venue id. */
async function ensureClosurePitches(q) {
  const host = await q.query(`SELECT id FROM venues WHERE name = $1 LIMIT 1`, [HOST_VENUE]);
  if (host.rows.length === 0) return null;
  for (const c of CLOSURE_PITCHES) {
    await q.query(
      `INSERT INTO pitches (venue_id, name, format) VALUES ($1, $2, $3)
       ON CONFLICT (venue_id, name) DO NOTHING`,
      [host.rows[0].id, c.name, c.format]
    );
  }
  return host.rows[0].id;
}

/**
 * Replace the retired 9v9 markings with the standalone 9v9: games booked on
 * them move across at the same kick-off (keeping refs), then they're removed.
 * No-op once done.
 */
async function retireOldClosurePitches(q) {
  const old = await q.query(
    `SELECT p.id FROM pitches p JOIN venues v ON v.id = p.venue_id
      WHERE v.name = $1 AND p.name = ANY($2::text[])`,
    [HOST_VENUE, RETIRED_PITCHES]
  );
  if (old.rows.length === 0) return 0;
  const hostId = await ensureClosurePitches(q);
  const target = await q.query(
    `SELECT id FROM pitches WHERE venue_id = $1 AND name = $2`,
    [hostId, CLOSURE_PITCHES[0].name]
  );
  const newId = target.rows[0].id;
  const oldIds = old.rows.map(r => r.id);
  const moved = await q.query(`UPDATE allocations SET pitch_id = $1 WHERE pitch_id = ANY($2::int[])`, [newId, oldIds]);
  await q.query(`UPDATE allocation_history SET pitch_id = $1 WHERE pitch_id = ANY($2::int[])`, [newId, oldIds]);
  await q.query(`DELETE FROM time_slots WHERE pitch_id = ANY($1::int[])`, [oldIds]);
  await q.query(`DELETE FROM pitches WHERE id = ANY($1::int[])`, [oldIds]);
  console.log(`Replaced ${oldIds.length} marked-over 9v9 pitch(es) with Morley's standalone 9v9; moved ${moved.rowCount} allocation(s)`);
  return moved.rowCount;
}

const isHostPitch = (pitch) => (pitch.venue_name || '').toLowerCase() === HOST_VENUE.toLowerCase();

/** Is this one of Morley's closure-only pitches (never used outside the closure)? */
const isClosurePitch = (pitch) => isHostPitch(pitch) && CLOSURE_PITCHES.some(c => c.name === pitch.name);

/**
 * Closure kick-offs for a Morley pitch on a day. `standardSlots` are the
 * pitch's normal slots for that day: a pitch only plays on days it normally
 * does, and closure-only pitches play every Sat/Sun. Weekdays keep the
 * standard slots.
 */
function closureSlots(closure, pitch, day, standardSlots) {
  if (!isHostPitch(pitch)) return [];
  const planTimes = closure[day.toLowerCase()];
  if (isClosurePitch(pitch)) return Array.isArray(planTimes) ? planTimes.map(toTime) : [];
  if (!Array.isArray(planTimes) || standardSlots.length === 0) return standardSlots;
  return planTimes.map(toTime);
}

module.exports = {
  SETTING_KEY, CLOSED_VENUE, HOST_VENUE, DEFAULTS, KO_WINDOWS, CLOSURE_PITCHES,
  isJunior11, toTime, validateClosure, loadClosure, saveClosure, isClosedOn,
  ensureClosurePitches, retireOldClosurePitches, isHostPitch, isClosurePitch, closureSlots,
};

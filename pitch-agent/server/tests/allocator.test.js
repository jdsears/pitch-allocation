/**
 * Behaviour tests for the allocator using node:test and a stubbed pg pool —
 * no database needed. Run with: npm test  (node --test server/tests)
 *
 * These cover the rules that are easy to silently break:
 *  - age-based pitch restrictions (U13/14 → Shropham, U15+ → Morley)
 *  - team home-venue preference (incl. lifting age limits at that venue)
 *  - preference never starves a fixture with no alternative venue
 *  - team format exceptions
 *  - kick-off rotation
 *  - Shropham closure: Morley-only plan, 9v9 markings, junior goals grouping,
 *    moving games off Shropham
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const VENUE_MORLEY = 1;
const VENUE_SHROPHAM = 2;
const PITCHES = [
  { id: 10, venue_id: VENUE_MORLEY, name: '11v11', format: '11v11', min_age_group: 'U15', max_age_group: null, venue_name: 'Morley' },
  { id: 20, venue_id: VENUE_SHROPHAM, name: '11v11', format: '11v11', min_age_group: null, max_age_group: 'U14', venue_name: 'Shropham' },
  { id: 30, venue_id: VENUE_MORLEY, name: '7v7 (Main)', format: '7v7', min_age_group: null, max_age_group: null, venue_name: 'Morley' },
  { id: 40, venue_id: VENUE_MORLEY, name: '3v3', format: '3v3', min_age_group: null, max_age_group: null, venue_name: 'Morley' },
  // Closure-only 9v9 markings: no standard slots, never used outside closure
  { id: 50, venue_id: VENUE_MORLEY, name: '9v9 over 11v11', format: '9v9', min_age_group: null, max_age_group: null, venue_name: 'Morley' },
  { id: 60, venue_id: VENUE_MORLEY, name: '9v9 over 7v7', format: '9v9', min_age_group: null, max_age_group: null, venue_name: 'Morley' },
];
const SLOTS = {
  10: ['10:00:00', '12:30:00'],
  20: ['10:00:00', '12:00:00', '14:00:00'],
  30: ['10:00:00', '11:15:00'],
  40: ['10:00:00', '11:15:00', '12:30:00'],
};

// Mutable per-test state the fake pool serves from
const state = { teams: [], fixtures: [], history: [], inserted: [], existing: [], moved: [], closure: null };

function fakeQuery(sql, params) {
  const s = sql.replace(/\s+/g, ' ');
  if (s.includes('BEGIN') || s.includes('COMMIT') || s.includes('ROLLBACK')) return { rows: [] };
  if (s.includes('DELETE FROM allocations')) return { rowCount: 0, rows: [] };
  if (s.includes('FROM app_settings')) return { rows: state.closure ? [{ value: state.closure }] : [] };
  if (s.includes('SELECT id FROM venues WHERE name')) return { rows: [{ id: VENUE_MORLEY }] };
  if (s.startsWith('INSERT INTO pitches')) return { rows: [] };
  if (s.includes('a.updated_at, f.match_date FROM allocations')) return { rows: state.existing };
  if (s.includes('SELECT * FROM fixtures WHERE id = ANY')) {
    return { rows: state.existingFixtures.filter(f => params[0].includes(f.id)) };
  }
  if (s.includes('SELECT f.* FROM fixtures')) return { rows: state.fixtures };
  if (s.includes('FROM pitches p')) return { rows: PITCHES };
  if (s.includes('FROM teams WHERE active')) return { rows: state.teams };
  if (s.includes('SELECT a.fixture_id, a.pitch_id, a.allocated_kick_off FROM allocations')) {
    return { rows: state.existing.filter(e => e.match_date === params[0]) };
  }
  if (s.includes('FROM time_slots')) {
    return { rows: (SLOTS[params[0]] || []).map(k => ({ kick_off: k })) };
  }
  if (s.includes('SELECT kick_off FROM allocation_history')) {
    const team = String(params[0]).replace(/%/g, '').toLowerCase();
    const hit = state.history.find(h => h.team.toLowerCase().includes(team) && h.pitch_id === params[1]);
    return { rows: hit ? [{ kick_off: hit.kick_off }] : [] };
  }
  if (s.startsWith('INSERT INTO allocations')) {
    state.inserted.push({ fixture_id: params[0], pitch_id: params[1], kick_off: params[2] });
    return { rows: [{ id: state.inserted.length }] };
  }
  if (s.startsWith('INSERT INTO allocation_history')) return { rows: [] };
  if (s.startsWith('UPDATE fixtures')) return { rows: [] };
  if (s.startsWith('UPDATE allocations SET pitch_id')) {
    state.moved.push({ allocation_id: params[2], pitch_id: params[0], kick_off: params[1] });
    return { rowCount: 1, rows: [] };
  }
  if (s.startsWith('UPDATE allocations')) return { rowCount: 0, rows: [] };
  throw new Error('Unstubbed SQL in test: ' + s.slice(0, 100));
}

const fakeClient = { query: async (sql, params) => fakeQuery(sql, params), release: () => {} };
const fakePool = { connect: async () => fakeClient, query: async (sql, params) => fakeQuery(sql, params) };

// Inject the fake pool before the allocator loads it
const poolPath = path.resolve(__dirname, '../db/pool.js');
require.cache[poolPath] = { id: poolPath, filename: poolPath, loaded: true, exports: fakePool };
const { allocateFixtures } = require('../services/allocator');

const WEEK = '2026-06-08'; // Monday; fixtures land on Saturday the 13th
const fix = (id, home, age, fmt, over = {}) => ({
  id, home_team: home, away_team: 'Opposition', age_group: age, gender: 'boys',
  format: fmt, format_override: false, match_date: '2026-06-13', kick_off: null,
  is_home_game: true, ...over,
});

function reset({ teams = [], fixtures = [], history = [], existing = [], existingFixtures = [], closure = null } = {}) {
  state.teams = teams;
  state.fixtures = fixtures;
  state.history = history;
  state.inserted = [];
  state.existing = existing;
  state.existingFixtures = existingFixtures;
  state.moved = [];
  state.closure = closure;
}

// Shropham closed for the test weekend (Sat 13 / Sun 14 June)
const CLOSURE = {
  enabled: true, from: '2026-06-13', to: '2026-06-14',
  saturday: ['09:30', '11:00', '12:30'], sunday: ['09:30', '12:00', '14:30'],
  junior_goals: 'first', enabled_at: '2026-06-01T00:00:00Z',
};
const SUN = { match_date: '2026-06-14' };
const koOf = (fixtureId) => state.inserted.find(i => i.fixture_id === fixtureId)?.kick_off;
const pitchOf = (fixtureId) => state.inserted.find(i => i.fixture_id === fixtureId)?.pitch_id;

test('U13/U14 go to Shropham, U15+ to Morley (age-based rules)', async () => {
  reset({
    fixtures: [fix(1, 'Morley YFC U14 Lions', 'U14', '11v11'), fix(2, 'Morley YFC U15 Falcons', 'U15', '11v11')],
  });
  const res = await allocateFixtures(WEEK);
  assert.equal(res.allocated, 2);
  assert.equal(state.inserted.find(i => i.fixture_id === 1).pitch_id, 20, 'U14 → Shropham');
  assert.equal(state.inserted.find(i => i.fixture_id === 2).pitch_id, 10, 'U15 → Morley');
});

test('home-venue preference lifts age limit at that venue', async () => {
  reset({
    teams: [{ name: 'Morley YFC U14 Lions', format: null, default_camera: null, home_venue_id: VENUE_MORLEY }],
    fixtures: [fix(1, 'Morley YFC U14 Lions', 'U14', '11v11')],
  });
  const res = await allocateFixtures(WEEK);
  assert.equal(res.allocated, 1);
  assert.equal(state.inserted[0].pitch_id, 10, 'U14 with Morley preference uses the full-size pitch');
});

test('preference never starves fixtures with no alternative venue', async () => {
  reset({
    teams: [{ name: 'Morley YFC U14 Lions', format: null, default_camera: null, home_venue_id: VENUE_MORLEY }],
    fixtures: [
      fix(1, 'Morley YFC U15 A', 'U15', '11v11'),
      fix(2, 'Morley YFC U15 B', 'U15', '11v11'),
      fix(3, 'Morley YFC U14 Lions', 'U14', '11v11'),
    ],
  });
  const res = await allocateFixtures(WEEK);
  assert.equal(res.allocated, 3, 'nobody left unallocated');
  const u15Pitches = state.inserted.filter(i => i.fixture_id !== 3).map(i => i.pitch_id);
  assert.deepEqual(u15Pitches, [10, 10], 'U15s (Morley-only) keep the Morley slots');
  assert.equal(state.inserted.find(i => i.fixture_id === 3).pitch_id, 20, 'preferring U14 overflows to Shropham');
});

test('team format exception is respected', async () => {
  reset({
    teams: [{ name: 'Morley YFC U12 Owls', format: '11v11', default_camera: null, home_venue_id: null }],
    fixtures: [fix(1, 'Morley YFC U12 Owls', 'U12', '9v9')],
  });
  const res = await allocateFixtures(WEEK);
  assert.equal(res.allocated, 1);
  assert.equal(state.inserted[0].pitch_id, 20, 'U12 with 11v11 exception lands on an 11v11 pitch');
});

test('U5/U6/U7 mini-soccer goes to the 3v3 pitch', async () => {
  reset({
    fixtures: [
      fix(1, 'Morley YFC U6 Cubs', 'U6', '3v3'),
      fix(2, 'Morley YFC U7 Tigers', 'U7', '3v3'),
      // U5 arrives with a stale 5v5 format (as scraped/imported data would) —
      // the allocator must correct it to 3v3, not fall back to 11v11
      fix(3, 'Morley YFC U5 Acorns', 'U5', '5v5'),
    ],
  });
  const res = await allocateFixtures(WEEK);
  assert.equal(res.allocated, 3);
  assert.ok(state.inserted.every(i => i.pitch_id === 40), 'all land on the Morley 3v3 pitch');
});

test('vets (no U-number = adult) go to the full-size Morley 11v11, never Shropham', async () => {
  reset({
    fixtures: [
      fix(1, 'Morley Youth F.C. Vets', 'VETS', '11v11'),
      // null age group must also route as adult, not 'fits anywhere'
      fix(2, 'Morley Youth F.C. Veterans', null, '11v11', { format_override: true }),
    ],
  });
  const res = await allocateFixtures(WEEK);
  assert.equal(res.allocated, 2);
  assert.ok(state.inserted.every(i => i.pitch_id === 10), 'adults on Morley full-size, not the U14-max junior pitch');
});

test('shared format map matches the 2026/27 league rules', () => {
  const { computeFormat } = require('../lib/formats');
  assert.equal(computeFormat('U5', 'boys'), '3v3');
  assert.equal(computeFormat('U5', 'girls'), '3v3');
  assert.equal(computeFormat('U8', 'boys'), '5v5');
  assert.equal(computeFormat('U9', 'boys'), '5v5', 'U9 stays 5v5 this season');
  assert.equal(computeFormat('U9', 'girls'), '5v5');
  assert.equal(computeFormat('U10', 'boys'), '7v7');
  assert.equal(computeFormat('U11', 'boys'), '7v7', 'U11 is 7v7 this season');
  assert.equal(computeFormat('U12', 'boys'), '9v9');
  assert.equal(computeFormat('U13', 'boys'), '9v9', 'U13 stays 9v9 this season');
  assert.equal(computeFormat('U14', 'boys'), '11v11');
  assert.equal(computeFormat('U14', 'girls'), '9v9', 'girls U14 stays 9v9');
  assert.equal(computeFormat('unknown', 'boys'), '11v11');
  assert.equal(computeFormat('VETS', 'vets'), '11v11', 'vets are full 11v11');
});

test('kick-off rotation: last week\'s early team goes later', async () => {
  reset({
    fixtures: [fix(1, 'Morley YFC U10 Reds', 'U10', '7v7'), fix(2, 'Morley YFC U10 Blues', 'U10', '7v7')],
    history: [
      { team: 'Morley YFC U10 Reds', pitch_id: 30, kick_off: '10:00:00' },  // had early last time
      { team: 'Morley YFC U10 Blues', pitch_id: 30, kick_off: '11:15:00' }, // had late last time
    ],
  });
  const res = await allocateFixtures(WEEK);
  assert.equal(res.allocated, 2);
  assert.equal(state.inserted.find(i => i.fixture_id === 2).kick_off, '10:00:00', 'Blues rotate into the early slot');
  assert.equal(state.inserted.find(i => i.fixture_id === 1).kick_off, '11:15:00', 'Reds rotate to the later slot');
});

test('no matching pitch reports a conflict, not a crash', async () => {
  reset({ fixtures: [fix(1, 'Morley YFC U12 Owls', 'U12', '9v9')] }); // no 9v9 pitch in this fixture set
  const res = await allocateFixtures(WEEK);
  assert.equal(res.allocated, 0);
  assert.equal(res.conflicts.length, 1);
  assert.match(res.conflicts[0].reason, /9v9/);
});

test('closure: U14 plays junior 11v11 at Morley, Shropham unused, plan kick-offs', async () => {
  reset({
    closure: CLOSURE,
    fixtures: [fix(1, 'Morley YFC U14 Lions', 'U14', '11v11', SUN), fix(2, 'Morley YFC U15 Falcons', 'U15', '11v11', SUN)],
  });
  const res = await allocateFixtures(WEEK);
  assert.equal(res.allocated, 2);
  assert.ok(state.inserted.every(i => i.pitch_id === 10), 'both on Morley 11v11');
  assert.deepEqual(state.inserted.map(i => i.kick_off).sort(), ['09:30:00', '12:00:00'], 'Sunday plan times, one 11v11 at a time');
});

test('closure: dates outside the window keep the normal two-venue rules', async () => {
  reset({
    closure: { ...CLOSURE, from: '2026-06-20', to: null },
    fixtures: [fix(1, 'Morley YFC U14 Lions', 'U14', '11v11')],
  });
  await allocateFixtures(WEEK);
  assert.equal(pitchOf(1), 20, 'U14 still goes to Shropham before the closure starts');
});

test('closure: games spread across kick-offs to ease parking', async () => {
  reset({
    closure: CLOSURE,
    fixtures: [
      fix(1, 'Morley YFC U6 Cubs', 'U6', '3v3'),
      fix(2, 'Morley YFC U10 Reds', 'U10', '7v7'),
      fix(3, 'Morley YFC U16 Hawks', 'U16', '11v11'),
    ],
  });
  await allocateFixtures(WEEK);
  assert.deepEqual([koOf(1), koOf(2), koOf(3)].sort(), ['09:30:00', '11:00:00', '12:30:00'],
    'one game per kick-off rather than all three at 09:30');
});

test('closure: Saturday 9v9 is marked over the 11v11 and shares its slots', async () => {
  reset({
    closure: CLOSURE,
    fixtures: [
      fix(1, 'Morley YFC U16 Hawks', 'U16', '11v11'),
      fix(2, 'Morley YFC U12 Owls', 'U12', '9v9'),
      fix(3, 'Morley YFC U13 Kites', 'U13', '9v9'),
      fix(4, 'Morley YFC U12 Wrens', 'U12', '9v9'),
    ],
  });
  const res = await allocateFixtures(WEEK);
  assert.equal(res.allocated, 3, 'three Saturday slots between the 11v11 and its 9v9 marking');
  assert.equal(res.conflicts.length, 1);
  const nineV9 = state.inserted.filter(i => i.fixture_id !== 1);
  assert.ok(nineV9.every(i => i.pitch_id === 50), 'Saturday 9v9 uses the marking over the 11v11');
  const kos = state.inserted.map(i => i.kick_off);
  assert.equal(new Set(kos).size, kos.length, 'never an 11v11 and its 9v9 marking at the same time');
});

test('closure: Sunday 9v9 is marked over the 7v7 and runs alongside the 11v11', async () => {
  reset({
    closure: CLOSURE,
    fixtures: [
      fix(1, 'Morley YFC U12 Owls', 'U12', '9v9', SUN),
      fix(2, 'Morley YFC U10 Reds', 'U10', '7v7', SUN),
      fix(3, 'Morley YFC U16 Hawks', 'U16', '11v11', SUN),
    ],
  });
  const res = await allocateFixtures(WEEK);
  assert.equal(res.allocated, 3);
  assert.equal(pitchOf(1), 60, 'Sunday 9v9 uses the marking over the 7v7');
  assert.notEqual(koOf(1), koOf(2), '9v9 and the 7v7 it is marked over never clash');
});

test('closure: U14 junior-goal games grouped first (or last) on the 11v11', async () => {
  const fixtures = () => [
    fix(1, 'Morley YFC U16 Hawks', 'U16', '11v11', SUN),
    fix(2, 'Morley YFC U14 Lions', 'U14', '11v11', SUN),
    fix(3, 'Morley Youth F.C. Vets', 'VETS', '11v11', SUN),
  ];
  reset({ closure: CLOSURE, fixtures: fixtures() });
  await allocateFixtures(WEEK);
  assert.equal(koOf(2), '09:30:00', 'U14 first, then full-size goals for the rest of the day');

  reset({ closure: { ...CLOSURE, junior_goals: 'last' }, fixtures: fixtures() });
  await allocateFixtures(WEEK);
  assert.equal(koOf(2), '14:30:00', 'U14 last when set to last');
});

test('closure: a confirmed Shropham game moves to Morley, keeping its allocation (and ref)', async () => {
  const shrophamGame = fix(9, 'Morley YFC U14 Lions', 'U14', '11v11', SUN);
  reset({
    closure: CLOSURE,
    existingFixtures: [shrophamGame],
    existing: [
      { id: 77, fixture_id: 9, pitch_id: 20, allocated_kick_off: '10:00:00', updated_at: '2026-05-20T00:00:00Z', match_date: '2026-06-14' },
    ],
  });
  const res = await allocateFixtures(WEEK);
  assert.equal(res.moved, 1);
  assert.deepEqual(state.moved, [{ allocation_id: 77, pitch_id: 10, kick_off: '09:30:00' }], 'same allocation row, now Morley 11v11');
  assert.equal(state.inserted.length, 0, 'no new allocation created');
});

test('closure: Morley games at old times move only if set before the switch went on', async () => {
  const old = fix(8, 'Morley YFC U10 Reds', 'U10', '7v7', SUN);
  const manual = fix(9, 'Morley YFC U10 Blues', 'U10', '7v7', SUN);
  reset({
    closure: CLOSURE,
    existingFixtures: [old, manual],
    existing: [
      { id: 70, fixture_id: 8, pitch_id: 30, allocated_kick_off: '10:00:00', updated_at: '2026-05-20T00:00:00Z', match_date: '2026-06-14' },
      { id: 71, fixture_id: 9, pitch_id: 30, allocated_kick_off: '11:15:00', updated_at: '2026-06-05T00:00:00Z', match_date: '2026-06-14' },
    ],
  });
  const res = await allocateFixtures(WEEK);
  assert.equal(res.moved, 1);
  assert.equal(state.moved[0].allocation_id, 70, 'the pre-switch 10:00 game is re-timed');
});

test('closure settings: league kick-off windows and dates are validated', () => {
  const { validateClosure } = require('../lib/shrophamClosure');
  assert.ok(validateClosure({ enabled: true, from: '2026-10-31' }).value, 'defaults are valid');
  assert.match(validateClosure({ enabled: true, from: '2026-10-31', saturday: '09:30, 13:00' }).error, /Saturday.*12:30/);
  assert.match(validateClosure({ enabled: true, from: '2026-10-31', sunday: '09:00' }).error, /Sunday/);
  assert.match(validateClosure({ enabled: true, from: '' }).error, /date/);
  assert.match(validateClosure({ enabled: true, from: '2026-10-31', to: '2026-10-01' }).error, /before/);
  assert.deepEqual(validateClosure({ enabled: true, from: '2026-10-31', saturday: '9:30,11:00, 12:30' }).value.saturday, ['09:30', '11:00', '12:30']);
});

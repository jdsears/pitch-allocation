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
];
const SLOTS = {
  10: ['10:00:00', '12:30:00'],
  20: ['10:00:00', '12:00:00', '14:00:00'],
  30: ['10:00:00', '11:15:00'],
};

// Mutable per-test state the fake pool serves from
const state = { teams: [], fixtures: [], history: [], inserted: [] };

function fakeQuery(sql, params) {
  const s = sql.replace(/\s+/g, ' ');
  if (s.includes('BEGIN') || s.includes('COMMIT') || s.includes('ROLLBACK')) return { rows: [] };
  if (s.includes('DELETE FROM allocations')) return { rowCount: 0, rows: [] };
  if (s.includes('SELECT f.* FROM fixtures')) return { rows: state.fixtures };
  if (s.includes('FROM pitches p')) return { rows: PITCHES };
  if (s.includes('FROM teams WHERE active')) return { rows: state.teams };
  if (s.includes('SELECT a.pitch_id, a.allocated_kick_off FROM allocations')) return { rows: [] };
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

function reset({ teams = [], fixtures = [], history = [] } = {}) {
  state.teams = teams;
  state.fixtures = fixtures;
  state.history = history;
  state.inserted = [];
}

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

test('kick-off rotation: last week\'s early team goes later', async () => {
  reset({
    fixtures: [fix(1, 'Morley YFC U9 Reds', 'U9', '7v7'), fix(2, 'Morley YFC U9 Blues', 'U9', '7v7')],
    history: [
      { team: 'Morley YFC U9 Reds', pitch_id: 30, kick_off: '10:00:00' },  // had early last time
      { team: 'Morley YFC U9 Blues', pitch_id: 30, kick_off: '11:15:00' }, // had late last time
    ],
  });
  const res = await allocateFixtures(WEEK);
  assert.equal(res.allocated, 2);
  assert.equal(state.inserted.find(i => i.fixture_id === 2).kick_off, '10:00:00', 'Blues rotate into the early slot');
  assert.equal(state.inserted.find(i => i.fixture_id === 1).kick_off, '11:15:00', 'Reds rotate to the later slot');
});

test('no matching pitch reports a conflict, not a crash', async () => {
  reset({ fixtures: [fix(1, 'Morley YFC U11 Owls', 'U11', '9v9')] }); // no 9v9 pitch in this fixture set
  const res = await allocateFixtures(WEEK);
  assert.equal(res.allocated, 0);
  assert.equal(res.conflicts.length, 1);
  assert.match(res.conflicts[0].reason, /9v9/);
});

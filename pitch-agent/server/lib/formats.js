/**
 * Age group → pitch format mapping. THE single source of truth server-side —
 * require this instead of copying the map (8 drifting copies caused U6/U7
 * to import as 5v5 after the 3v3 change; consolidating prevents a repeat).
 *
 * League rules (2026/27 — formats moved up a year over the summer):
 * U5–U7 play 3v3 mini-soccer at Morley, U8–U9 5v5, U10–U11 7v7,
 * U12–U13 9v9, 11v11 from U14. Girls U14 stays 9v9 (one year later).
 *
 * Note: 11v11 splits by pitch SIZE, handled by pitch age restrictions
 * (not formats): U14 play JUNIOR 11v11 on Shropham's undersized pitch
 * (max_age_group=U14); full-size 11v11 from U15 on Morley's pitch
 * (min_age_group=U15). See db/schema.js data rules.
 */

const AGE_TO_FORMAT = {
  U5: '3v3', U6: '3v3', U7: '3v3',
  U8: '5v5', U9: '5v5',
  U10: '7v7', U11: '7v7',
  U12: '9v9', U13: '9v9',
  U14: '11v11', U15: '11v11',
  U16: '11v11', U17: '11v11', U18: '11v11',
};

const GIRLS_AGE_TO_FORMAT = {
  ...AGE_TO_FORMAT,
  U14: '9v9',
};

function computeFormat(ageGroup, gender) {
  const map = gender === 'girls' ? GIRLS_AGE_TO_FORMAT : AGE_TO_FORMAT;
  return map[ageGroup] || '11v11';
}

/** All formats the club uses, smallest first — for dropdowns/validation. */
const ALL_FORMATS = ['3v3', '5v5', '7v7', '9v9', '11v11'];

module.exports = { AGE_TO_FORMAT, GIRLS_AGE_TO_FORMAT, computeFormat, ALL_FORMATS };

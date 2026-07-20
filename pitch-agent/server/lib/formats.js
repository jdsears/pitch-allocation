/**
 * Age group → pitch format mapping. THE single source of truth server-side —
 * require this instead of copying the map (8 drifting copies caused U6/U7
 * to import as 5v5 after the 3v3 change; consolidating prevents a repeat).
 *
 * Club rules: U5–U7 play 3v3 mini-soccer at Morley, U8 5v5, U9–U10 7v7,
 * U11–U12 9v9, U13+ 11v11. Girls play formats one year later (NWGFL):
 * U9 stays 5v5, U11 7v7, U13/U14 9v9, 11v11 from U15.
 */

const AGE_TO_FORMAT = {
  U5: '3v3', U6: '3v3', U7: '3v3', U8: '5v5',
  U9: '7v7', U10: '7v7',
  U11: '9v9', U12: '9v9',
  U13: '11v11', U14: '11v11', U15: '11v11',
  U16: '11v11', U17: '11v11', U18: '11v11',
};

const GIRLS_AGE_TO_FORMAT = {
  ...AGE_TO_FORMAT,
  U9: '5v5', U11: '7v7', U13: '9v9', U14: '9v9',
};

function computeFormat(ageGroup, gender) {
  const map = gender === 'girls' ? GIRLS_AGE_TO_FORMAT : AGE_TO_FORMAT;
  return map[ageGroup] || '11v11';
}

/** All formats the club uses, smallest first — for dropdowns/validation. */
const ALL_FORMATS = ['3v3', '5v5', '7v7', '9v9', '11v11'];

module.exports = { AGE_TO_FORMAT, GIRLS_AGE_TO_FORMAT, computeFormat, ALL_FORMATS };

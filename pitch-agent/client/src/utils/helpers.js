/**
 * Clean up long FA Full-Time team names for display
 * "Morley Youth F.C. U13 Stallions" → "Morley YFC U13 Stallions"
 */
export function cleanTeamName(name) {
  if (!name) return '';
  return name
    .replace(/Youth F\.?C\.?/i, 'YFC')
    .replace(/Football Club/i, 'FC')
    .replace(/F\.C\./i, 'FC')
    .trim();
}

/**
 * Safely parse a YYYY-MM-DD date string into a local Date object.
 * Returns null if the input is missing or malformed.
 * Uses explicit year/month/day construction to avoid timezone-related off-by-one issues.
 */
export function parseDate(dateStr) {
  if (!dateStr) return null;
  const str = typeof dateStr === 'string' ? dateStr : String(dateStr);
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(y, m - 1, d);
  if (isNaN(date.getTime())) return null;
  return date;
}

/**
 * Format a date string (YYYY-MM-DD) to a readable day label
 */
export function formatMatchDay(dateStr) {
  const date = parseDate(dateStr);
  if (!date) return '';
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getDay()];
}

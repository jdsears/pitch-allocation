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
 * Format a date string (YYYY-MM-DD) to a readable day label
 */
export function formatMatchDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getDay()];
}

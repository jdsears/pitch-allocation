/**
 * OCR Fixture Parser
 *
 * Uses Claude's vision API to extract fixture data from screenshots
 * of FA Full-Time or similar fixture lists.
 */

const Anthropic = require('@anthropic-ai/sdk').default;

const AGE_TO_FORMAT = {
  U6: '5v5', U7: '5v5', U8: '5v5',
  U9: '7v7', U10: '7v7',
  U11: '9v9', U12: '9v9',
  U13: '11v11', U14: '11v11', U15: '11v11', U16: '11v11',
  U17: '11v11', U18: '11v11'
};

// Girls play 9v9 at U13 and U14 (NWGFL rules) — 11v11 from U15
const GIRLS_AGE_TO_FORMAT = {
  ...AGE_TO_FORMAT,
  U13: '9v9', U14: '9v9'
};

function isMorleyHome(homeTeam) {
  return homeTeam.toLowerCase().includes('morley');
}

/**
 * Parse fixtures from an image using Claude vision.
 *
 * @param {Buffer} imageBuffer - The image file buffer
 * @param {string} mimeType - e.g. 'image/png', 'image/jpeg'
 * @param {string} gender - 'boys' or 'girls' (default hint)
 * @returns {Array} Parsed fixtures ready for import
 */
async function parseFixturesFromImage(imageBuffer, mimeType, gender = 'boys') {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required for OCR import');
  }

  const client = new Anthropic({ apiKey });

  const base64Image = imageBuffer.toString('base64');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType,
              data: base64Image,
            },
          },
          {
            type: 'text',
            text: `Extract all football/soccer fixtures from this image. This is from FA Full-Time or a similar fixture listing for Morley Youth FC.

For each fixture, extract:
- match_date: in YYYY-MM-DD format
- kick_off: in HH:MM format (24h), or null if not shown
- home_team: full team name
- away_team: full team name
- age_group: e.g. U7, U8, U9, U10, U11, U12, U13, U14 etc. (extract from team names)
- venue_name: if shown

Return ONLY a valid JSON array, no markdown or explanation. Each element should be:
{"match_date":"YYYY-MM-DD","kick_off":"HH:MM","home_team":"...","away_team":"...","age_group":"U13","venue_name":"..."}

If a date is in DD/MM/YYYY or DD/MM/YY format, convert it to YYYY-MM-DD.
If you cannot find any fixtures, return an empty array [].`
          }
        ]
      }
    ]
  });

  // Extract JSON from the response
  const text = response.content[0].text.trim();

  // Try to parse - handle cases where Claude wraps in markdown code blocks
  let jsonStr = text;
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  let rawFixtures;
  try {
    rawFixtures = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Failed to parse OCR response as JSON: ${text.substring(0, 200)}`);
  }

  if (!Array.isArray(rawFixtures)) {
    throw new Error('OCR response was not an array of fixtures');
  }

  // Enrich with computed fields
  const fixtures = rawFixtures.map(f => ({
    league_code: f.league_code || '',
    match_date: f.match_date,
    kick_off: f.kick_off || null,
    home_team: f.home_team,
    away_team: f.away_team,
    venue_name: f.venue_name || '',
    is_home_game: isMorleyHome(f.home_team),
    age_group: f.age_group || null,
    format: ((f.gender || gender) === 'girls' ? GIRLS_AGE_TO_FORMAT : AGE_TO_FORMAT)[f.age_group] || '11v11',
    gender: f.gender || gender,
    match_type: 'League / Cup',
  }));

  return fixtures;
}

module.exports = { parseFixturesFromImage };

const axios = require('axios');
const { format } = require('date-fns');
const { getWeekSummary, getAllocationGrid, getMultiWeekOverview } = require('./allocator');

/**
 * Safely parse a YYYY-MM-DD date string into a local Date object.
 * Avoids timezone off-by-one by using explicit year/month/day constructor.
 */
function parseDate(dateStr) {
  if (!dateStr) return null;
  const str = typeof dateStr === 'string' ? dateStr : String(dateStr);
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(y, m - 1, d);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Safely format a date value (Date object or YYYY-MM-DD string) with date-fns.
 * Returns the fallback string if the value is invalid.
 */
function safeFormat(value, pattern, fallback = '') {
  let date;
  if (value instanceof Date) {
    date = isNaN(value.getTime()) ? null : value;
  } else {
    date = parseDate(value);
  }
  if (!date) return fallback;
  return format(date, pattern);
}

const WHATSAPP_API = 'https://graph.facebook.com/v18.0';

async function sendWhatsAppMessage(to, message) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;

  if (!token || !phoneId) {
    console.log('WhatsApp not configured - message preview:');
    console.log(message);
    return { preview: true, message };
  }

  try {
    const response = await axios.post(
      `${WHATSAPP_API}/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: { body: message }
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return { sent: true, id: response.data.messages?.[0]?.id };
  } catch (err) {
    console.error('WhatsApp send error:', err.response?.data || err.message);
    return { sent: false, error: err.message };
  }
}

function formatWeeklySummary(summary, gridUrl, gridData) {
  const weekStart = safeFormat(summary.weekStart, 'do MMMM', summary.weekStart);

  let msg = `⚽ *Pitch Allocations*\n`;
  msg += `📅 Week of ${weekStart}\n\n`;

  for (const venue of summary.venues) {
    const refsNeeded = parseInt(venue.refs_needed);
    const icon = refsNeeded === 0 ? '🟢' : refsNeeded <= 2 ? '🟠' : '🔴';
    msg += `${icon} *${venue.venue}:* ${venue.total_games} home games`;
    if (refsNeeded > 0) msg += ` (${refsNeeded} need a ref)`;
    msg += `\n`;
  }

  // Detailed match breakdown by venue
  if (gridData?.grid) {
    msg += `\n━━━━━━━━━━━━━━━\n`;
    for (const [venue, pitches] of Object.entries(gridData.grid)) {
      msg += `\n📍 *${venue}*\n`;
      for (const [pitch, dates] of Object.entries(pitches)) {
        for (const [date, matches] of Object.entries(dates)) {
          const dayName = safeFormat(date, 'EEE do MMM', date);
          msg += `\n*${pitch} — ${dayName}*\n`;
          for (const match of matches) {
            const ko = match.kick_off?.substring(0, 5) || '??:??';
            const refIcon = match.referee ? '🟢' : '🔴';
            const ref = match.referee || 'REF NEEDED';
            msg += `⏱ ${ko} | ${match.home_team} v ${match.away_team}\n`;
            msg += `     ${match.age_group} | ${refIcon} ${ref}\n`;
          }
        }
      }
    }
    msg += `\n━━━━━━━━━━━━━━━\n`;
  }

  if (summary.unrefereed.length > 0) {
    msg += `\n🔴 *Refs still needed:*\n`;
    for (const match of summary.unrefereed) {
      const date = safeFormat(match.match_date, 'EEE', '???');
      const ko = match.allocated_kick_off?.substring(0, 5);
      msg += `• ${date} ${ko} - ${match.age_group} @ ${match.venue_name}\n`;
    }
  }

  if (gridUrl) {
    msg += `\n📋 Full allocation + ref sign-up:\n${gridUrl}`;
    const calendarUrl = gridUrl.replace('/grid?', '/calendar?').replace(/week=/, 'week=');
    msg += `\n\n📅 Calendar view (share with managers):\n${calendarUrl}`;
  }

  return msg;
}

function formatDetailedGrid(gridData) {
  let msg = `⚽ *PITCH ALLOCATIONS*\n`;
  msg += `📅 ${safeFormat(gridData.weekStart, 'do MMMM', gridData.weekStart)} - ${safeFormat(gridData.weekEnd, 'do MMMM', gridData.weekEnd)}\n`;
  msg += `━━━━━━━━━━━━━━━\n\n`;

  for (const [venue, pitches] of Object.entries(gridData.grid)) {
    msg += `📍 *${venue.toUpperCase()}*\n\n`;

    for (const [pitch, dates] of Object.entries(pitches)) {
      for (const [date, matches] of Object.entries(dates)) {
        const dayName = safeFormat(date, 'EEEE do', date);
        msg += `*${pitch} - ${dayName}*\n`;

        for (const match of matches) {
          const ko = match.kick_off?.substring(0, 5);
          const refIcon = match.referee ? '🟢' : '🔴';
          const ref = match.referee || 'REF NEEDED';
          msg += `${ko} | ${match.home_team} v ${match.away_team}\n`;
          msg += `       ${refIcon} ${ref}`;
          if (match.camera) msg += ` | 📹 ${match.camera}`;
          msg += `\n`;
        }
        msg += `\n`;
      }
    }
    msg += `━━━━━━━━━━━━━━━\n`;
  }

  return msg;
}

async function sendWeeklyAllocation(weekStartDate, gridUrl) {
  const [summary, gridData] = await Promise.all([
    getWeekSummary(weekStartDate),
    getAllocationGrid(weekStartDate),
  ]);
  const summaryMsg = formatWeeklySummary(summary, gridUrl, gridData);
  const result = await sendWhatsAppMessage(process.env.WHATSAPP_GROUP_ID, summaryMsg);
  return { ...result, message: summaryMsg };
}

function formatOverviewMessage(overviewData, baseUrl) {
  const startLabel = safeFormat(overviewData.weekStart, 'do MMM', overviewData.weekStart);
  const endLabel = safeFormat(overviewData.overviewEnd, 'do MMM yyyy', overviewData.overviewEnd);

  let msg = `⚽ *4-WEEK OVERVIEW*\n`;
  msg += `📅 ${startLabel} — ${endLabel}\n`;

  // Aggregate totals
  let totalGames = 0;
  let totalRefs = 0;
  let totalNeeded = 0;
  for (const week of overviewData.weeks) {
    totalGames += week.totalGames;
    totalRefs += week.refsAssigned;
    totalNeeded += week.refsNeeded;
  }
  msg += `📊 ${totalGames} games | ${totalRefs} refs assigned | ${totalNeeded} needed\n`;
  msg += `━━━━━━━━━━━━━━━\n`;

  for (const week of overviewData.weeks) {
    const wsLabel = safeFormat(week.weekStart, 'do MMM', week.weekStart);
    const icon = week.refsNeeded === 0 ? '🟢' : week.refsNeeded <= 2 ? '🟠' : '🔴';

    msg += `\n📅 *Week of ${wsLabel}*\n`;

    if (week.totalGames === 0) {
      msg += `No fixtures\n`;
      continue;
    }

    msg += `${icon} ${week.totalGames} game${week.totalGames !== 1 ? 's' : ''}`;
    if (week.refsNeeded > 0) {
      msg += ` (${week.refsNeeded} need a ref)`;
    }
    if (week.unallocated > 0) {
      msg += ` + ${week.unallocated} unallocated`;
    }
    msg += `\n\n`;

    // Group allocations by date
    let currentDate = null;
    for (const a of week.allocations) {
      if (a.match_date !== currentDate) {
        currentDate = a.match_date;
        const dayLabel = safeFormat(a.match_date, 'EEE do MMM', a.match_date);
        msg += `*${dayLabel}*\n`;
      }
      const ko = a.kick_off?.substring(0, 5) || '??:??';
      const refIcon = a.referee ? '🟢' : '🔴';
      const ref = a.referee || 'REF NEEDED';
      msg += `⏱ ${ko} | ${a.home_team} v ${a.away_team}\n`;
      msg += `     📍 ${a.venue_name} ${a.pitch_name} | ${a.age_group} | ${refIcon} ${ref}\n`;
    }
  }

  msg += `\n━━━━━━━━━━━━━━━\n`;

  if (baseUrl) {
    msg += `\n📋 Full allocation + ref sign-up:\n${baseUrl}/grid`;
    msg += `\n\n📅 Calendar view (share with managers):\n${baseUrl}/calendar`;
  }

  return msg;
}

async function generateOverviewMessage(startDate, numWeeks, baseUrl) {
  const overviewData = await getMultiWeekOverview(startDate, numWeeks);
  return formatOverviewMessage(overviewData, baseUrl);
}

module.exports = { sendWhatsAppMessage, sendWeeklyAllocation, formatWeeklySummary, formatDetailedGrid, generateOverviewMessage };

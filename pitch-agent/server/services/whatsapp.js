const axios = require('axios');
const { format } = require('date-fns');
const { getWeekSummary } = require('./allocator');

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

function formatWeeklySummary(summary, gridUrl) {
  const weekStart = format(new Date(summary.weekStart), 'do MMMM');

  let msg = `⚽ *Pitch Allocations*\n`;
  msg += `📅 Week of ${weekStart}\n\n`;

  for (const venue of summary.venues) {
    const refsNeeded = parseInt(venue.refs_needed);
    const icon = refsNeeded === 0 ? '🟢' : refsNeeded <= 2 ? '🟠' : '🔴';
    msg += `${icon} *${venue.venue}:* ${venue.total_games} home games`;
    if (refsNeeded > 0) msg += ` (${refsNeeded} need a ref)`;
    msg += `\n`;
  }

  if (summary.unrefereed.length > 0) {
    msg += `\n🔴 *Refs needed:*\n`;
    for (const match of summary.unrefereed) {
      const date = format(new Date(match.match_date), 'EEE');
      const ko = match.allocated_kick_off?.substring(0, 5);
      msg += `• ${date} ${ko} - ${match.age_group} @ ${match.venue_name}\n`;
    }
  }

  if (gridUrl) {
    msg += `\n📋 Full allocation + ref sign-up:\n${gridUrl}`;
  }

  return msg;
}

function formatDetailedGrid(gridData) {
  let msg = `⚽ *PITCH ALLOCATIONS*\n`;
  msg += `📅 ${format(new Date(gridData.weekStart), 'do MMMM')} - ${format(new Date(gridData.weekEnd), 'do MMMM')}\n`;
  msg += `━━━━━━━━━━━━━━━\n\n`;

  for (const [venue, pitches] of Object.entries(gridData.grid)) {
    msg += `📍 *${venue.toUpperCase()}*\n\n`;

    for (const [pitch, dates] of Object.entries(pitches)) {
      for (const [date, matches] of Object.entries(dates)) {
        const dayName = format(new Date(date), 'EEEE do');
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
  const summary = await getWeekSummary(weekStartDate);
  const summaryMsg = formatWeeklySummary(summary, gridUrl);
  const result = await sendWhatsAppMessage(process.env.WHATSAPP_GROUP_ID, summaryMsg);
  return { ...result, message: summaryMsg };
}

module.exports = { sendWhatsAppMessage, sendWeeklyAllocation, formatWeeklySummary, formatDetailedGrid };

const cron = require('node-cron');
const { runScrape, hasFaConfig } = require('./scraper');

/**
 * Automatic fixture scraping.
 *
 * Cadence is controlled by SCRAPE_CRON (standard 5-field cron, server time).
 * Default: 06:00 every day plus an extra run Friday 18:00 so the weekend's
 * fixtures are fresh before allocation. Set SCRAPE_CRON to override, or
 * SCRAPE_AUTO=off to disable scheduling entirely (manual button still works).
 *
 * Scraping needs the FA club/season IDs — if they aren't configured we skip
 * scheduling and log a clear notice rather than launching doomed runs.
 */
const DEFAULT_CRONS = ['0 6 * * *', '0 18 * * 5'];

function startScheduler() {
  if (String(process.env.SCRAPE_AUTO || '').toLowerCase() === 'off') {
    console.log('[scheduler] Auto-scrape disabled (SCRAPE_AUTO=off)');
    return;
  }

  if (!hasFaConfig()) {
    console.log('[scheduler] Skipping auto-scrape — FA club/season IDs not configured');
    return;
  }

  const expressions = process.env.SCRAPE_CRON
    ? [process.env.SCRAPE_CRON]
    : DEFAULT_CRONS;

  let scheduled = 0;
  for (const expr of expressions) {
    if (!cron.validate(expr)) {
      console.warn(`[scheduler] Ignoring invalid cron expression: "${expr}"`);
      continue;
    }
    cron.schedule(expr, async () => {
      console.log(`[scheduler] Triggering scheduled scrape (${expr})`);
      try {
        const result = await runScrape('scheduled');
        if (result.skipped) {
          console.log('[scheduler] Scrape skipped —', result.reason);
        } else {
          console.log(`[scheduler] Scrape done — ${result.saved} saved of ${result.total}`);
        }
      } catch (err) {
        console.error('[scheduler] Scheduled scrape failed:', err.message);
      }
    });
    scheduled++;
  }

  console.log(`[scheduler] Auto-scrape active — ${scheduled} schedule(s): ${expressions.join(', ')}`);
}

module.exports = { startScheduler };

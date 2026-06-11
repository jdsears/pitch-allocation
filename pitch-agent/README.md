# ⚽ Morley YFC Pitch Allocation Agent

Automated pitch allocation system for Morley Youth Football Club. Replaces manual spreadsheet management with an intelligent allocation engine, live web grid, referee self-service, and WhatsApp integration.

## What It Does

1. **Fetches fixtures** from FA Full-Time (boys and girls, both filtered by club ID)
2. **Auto-allocates** home games to pitches based on format (5v5/7v7/9v9/11v11)
3. **Rotates kick-off times** so teams sharing a pitch get fair slot rotation
4. **Publishes** a summary to WhatsApp with a link to the live grid
5. **Referees claim matches** via a mobile-friendly web page
6. **Coaches submit requests** for friendlies, changes, or cancellations

## Weekly Workflow (Guy's perspective)

1. Open the admin dashboard
2. Click **Fetch Fixtures** → scrapes FA Full-Time for the latest fixtures
3. Click **Auto-Allocate** → engine assigns pitches and kick-off times
4. Review the grid, tweak anything manually if needed
5. Click **Publish to WhatsApp** → sends summary + link to the group
6. Refs claim their matches via the shared link
7. Done. No more spreadsheet screenshots.

---

## Deploy to Railway

### 1. Create a new project on Railway

- Go to [railway.app](https://railway.app)
- New Project → Deploy from GitHub repo (or upload)

### 2. Add a PostgreSQL database

- In your Railway project, click **+ New** → **Database** → **PostgreSQL**
- Railway will auto-set `DATABASE_URL` for you

### 3. Set environment variables

In the service settings, add:

```
NODE_ENV=production
BASE_URL=https://your-project.up.railway.app
ADMIN_PASSWORD=choose-a-password
FA_BOYS_CLUB_ID=926960945
FA_BOYS_SEASON_ID=353505162
FA_GIRLS_CLUB_ID=468454775
FA_GIRLS_SEASON_ID=199649392
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
```

`ADMIN_PASSWORD` protects the Admin tab and all admin actions (team/fixture
edits, allocation, publish). The referee claim page, public calendar and
request form are never password-protected. If the variable is unset, auth
is disabled entirely (useful for first deploy, but set it!).

Optional scrape schedule overrides: `SCRAPE_CRON` (default `0 6 * * *`)
and `SCRAPE_TZ` (default `Europe/London`).

For WhatsApp (optional, can add later):
```
WHATSAPP_TOKEN=your_token
WHATSAPP_PHONE_ID=your_phone_id
WHATSAPP_GROUP_ID=your_group_id
```

### 4. Run database migrations

In Railway's shell or via `railway run`:

```bash
node server/db/migrate.js
node server/db/seed.js
```

This creates all tables and seeds Morley + Shropham venues with their pitches.

### 5. Deploy

Railway will auto-detect the `nixpacks.json`, build the React client, and start the server.

Your app will be live at `https://your-project.up.railway.app`

---

## WhatsApp Setup (Optional - can use copy/paste initially)

The app works without WhatsApp API. When you click "Publish", it generates the formatted message which you can copy and paste into the WhatsApp group.

To automate it later:

1. Create a Meta Business account at [business.facebook.com](https://business.facebook.com)
2. Set up WhatsApp Business API in Meta Developer portal
3. Get your Phone Number ID and permanent access token
4. Add the env vars to Railway

---

## Tech Stack

- **Backend:** Node.js + Express + PostgreSQL
- **Frontend:** React
- **Scraping:** Puppeteer + Cheerio (for FA Full-Time)
- **Messaging:** WhatsApp Cloud API
- **Hosting:** Railway

## Project Structure

```
morley-pitch-agent/
├── server/
│   ├── index.js              # Express server
│   ├── db/
│   │   ├── pool.js           # PostgreSQL connection
│   │   ├── migrate.js        # Create tables
│   │   └── seed.js           # Seed venues & pitches
│   ├── routes/
│   │   ├── fixtures.js       # Fixture CRUD + scraping
│   │   ├── allocations.js    # Allocation grid + publish
│   │   ├── referees.js       # Ref pool + claims
│   │   └── general.js        # Venues + ad-hoc requests
│   └── services/
│       ├── scraper.js        # FA Full-Time scraper
│       ├── allocator.js      # Pitch allocation engine
│       └── whatsapp.js       # WhatsApp Cloud API
├── client/
│   ├── public/index.html
│   └── src/
│       ├── App.js            # Dashboard with routing
│       ├── components/
│       │   ├── AllocationGrid.js   # Main grid view
│       │   ├── AdminPanel.js       # Ref/venue management
│       │   └── RequestForm.js      # Coach request form
│       ├── pages/
│       │   └── RefClaimPage.js     # Public ref claim page
│       └── utils/api.js
├── railway.toml
├── nixpacks.json
└── .env.example
```

## Allocation Rules

- **Morley Saturday** (girls + U12B): KO slots at 10:00, 11:15, 12:30
- **Morley Sunday** (boys): KO slots at 10:00, 12:30
- **Shropham Saturday** (U12B): KO slots at 10:00, 12:00, 14:00
- **Shropham Sunday** (boys): KO slots at 10:00, 12:00, 14:00
- **Rotation:** Each team takes turns getting the 10am slot. If Team A had 10:00 last week and Team B had 11:15, this week Team B gets 10:00 and Team A gets 11:15
- **Format mapping:** U6-U8 → 5v5, U9-U10 → 7v7, U11-U12 → 9v9, U13+ → 11v11
- **Single ref pool** covering all matches across both days

## Manual Fixture Import

If the FA Full-Time scraper can't reach the site, use the Admin panel's Import tab. Paste CSV-format fixtures:

```
2026-03-21, 10:00, Morley YFC U13 Stallions, Wymondham Town U13, U13, boys
2026-03-22, 10:00, Morley YFC U10 Girls, Dereham Girls U10, U10, girls
```

---

Built by John Sears / MoonBoots Consultancy for Morley YFC.

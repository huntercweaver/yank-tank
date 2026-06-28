# The Yank Tank ⚽🇺🇸

A personal, **fully self-updating** soccer command center:

- **My Clubs** — Man City, AC Milan, PSV: live fixtures, results, league table, last-5 form, and an auto-pulled transfer/club news feed.
- **USMNT Central** — live USA fixtures + results, an **active-tournament banner** that detects the current/next competition automatically, "pool in action this week," and a live USMNT newswire.
- **The Pool** — every senior player mapped to his club, with live form.
- **The Pipeline** — prospects and dual-national watch list, plus a live "emerging in the news" strip.
- **Where It's Headed** — the trajectory read.

## How the data flows (nothing manual)

| Layer | Source | Updates |
|---|---|---|
| Fixtures, scores, results, standings, form, tournaments, rosters, ages, **club health** | **ESPN public API** (client-side) | every page load |
| **Deep per-player season stats** (apps, goals, assists, minutes, shots, cards, GK stats) | **`/api/player`** serverless function (ESPN athlete API) | per card, lazy + cached 3 h |
| Transfer & club news, USMNT newswire, youth & **injury/fitness** headlines | **`/api/news`** serverless function (RSS) | every load, cached 15 min |
| Out-on-loan players | **`/api/club-data`** serverless function (Wikipedia) | every load, cached 6 h |

There is **no API key and no cost**. Backends exist only because browsers can't fetch RSS, Wikipedia, or the deep ESPN athlete endpoints cross-origin; the functions do it server-side and return clean JSON.

**Club Health** (each club tab) is computed live from the schedule: last-5 form, points/game, goals for & against per game, goal difference, clean-sheet %, scored-in %, and current streak — with hot/cold colouring.

**Player stats** load lazily as you scroll (an IntersectionObserver fires the fetch ~200px before a card enters view), so even with deep stats on every player the page stays fast and ESPN isn't hammered.

**Injuries** come from headline filtering (injury/fitness/return keywords), not a structured feed — there's no free global-soccer injury API. Empty = no injury news, which is a good sign.

### Files
```
index.html         ← the dashboard
api/news.js        ← news (RSS): transfers, USMNT, youth, injuries
api/club-data.js   ← out-on-loan players (Wikipedia)
api/player.js      ← deep per-player season stats (ESPN athlete API)
api/digest.js      ← weekly push brief (Vercel cron)
package.json
vercel.json
```

### Tabs
- **This Week** — the home screen: a digest of your week, "what I missed" (recent results across all teams), and every upcoming fixture (clubs + USMNT) in date order with team tags.
- **My Clubs** — per club: health panel, competitions, fixtures, news, loans, academy, injuries.
- **USMNT Central** — tournament banner, **live group table + qualification scenario**, fixtures, pool-in-action, newswire.
- **The Pool** — the full 26 + fringe, tiered, with live stats/age/form.
- **The Pipeline / Where It's Headed** — prospects and the trajectory read.

### Weekly digest (optional, free)
`/api/digest` builds a weekly brief and runs automatically every **Monday 13:00 UTC** (set in `vercel.json` → `crons`). To receive it, add environment variables in Vercel (**Project → Settings → Environment Variables**):

- **Email (via Resend, free 100/day):** `RESEND_API_KEY`, `DIGEST_TO` (your email), `DIGEST_FROM` (start with `onboarding@resend.dev`).
- **Or webhook (Slack/Discord/phone):** `DIGEST_WEBHOOK` (an incoming webhook URL).

With nothing set, visiting `/api/digest` just returns the brief as JSON — handy for testing. Trigger it manually any time by opening that URL.

### Once-a-year upkeep
When a new season starts, update two things in the code (both have prior-season fallbacks, so nothing breaks if you forget):
- `CLUB_WIKI` titles in `api/club-data.js` → bump `2026-27` to the new season.
- `ACADEMY` seed names in `index.html` → refresh as kids graduate. Live youth news fills in automatically regardless.

## Deploy (matches your existing GitHub → Vercel flow)

1. Create a new GitHub repo (e.g. `yank-tank`) and upload these files, preserving the folder layout:
   ```
   index.html
   package.json
   vercel.json
   api/news.js
   ```
2. In Vercel: **Add New → Project → Import** the repo. No build settings needed — it's static + one function. Click **Deploy**.
3. Open the Vercel URL. Done. Every visit pulls fresh data.

> Opening `index.html` directly from your computer will show the live ESPN data but **not** the news feeds — the `/api/news` function only runs on Vercel. Always use the deployed URL.

## Tuning

- **Add a club:** add an entry to `CLUBS` (drives the My Clubs tab) and `CLUB_ESPN` (drives form + in-action) near the top of the script in `index.html`. Find ESPN team IDs at `site.api.espn.com/apis/site/v2/sports/soccer/{league}/teams`.
- **Change news sources:** edit the `FEEDS` array in `api/news.js`. Any public RSS/Atom soccer feed works.
- **Roster/prospect baselines:** `POOL` and `PIPELINE` in `index.html` seed those views; live news layers on top.

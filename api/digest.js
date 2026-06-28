// /api/digest.js — Vercel Scheduled Function (cron)
// Builds a weekly brief across your clubs + USMNT and delivers it.
//
// HOW DELIVERY WORKS (pick one — both are free, no code changes needed beyond env vars):
//   A) EMAIL via Resend (recommended): set env vars
//        RESEND_API_KEY   = your Resend key (free tier: 100 emails/day)
//        DIGEST_TO        = your email address
//        DIGEST_FROM      = a verified sender (e.g. onboarding@resend.dev to start)
//   B) WEBHOOK (Slack/Discord/IFTTT/your phone): set env var
//        DIGEST_WEBHOOK   = an incoming webhook URL; we POST { text } to it
//
// If neither is set, hitting the endpoint just returns the digest as JSON
// (handy for testing in the browser: /api/digest).
//
// SCHEDULE: configured in vercel.json -> crons (Mondays 13:00 UTC by default).
// You can also trigger it manually any time by visiting /api/digest.

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

// Keep this in sync with the CLUBS list in index.html.
const CLUBS = [
  { label: 'Man City', league: 'eng.1', id: '382', focus: 'Manchester City' },
  { label: 'AC Milan', league: 'ita.1', id: '103', focus: 'AC Milan' },
  { label: 'PSV',      league: 'ned.1', id: '148', focus: 'PSV Eindhoven' }
];

async function jget(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'YankTank/1.0' } });
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.json();
}

function parseEvents(j) {
  return (j.events || []).map(ev => {
    try {
      const c = ev.competitions[0];
      const home = c.competitors.find(x => x.homeAway === 'home');
      const away = c.competitors.find(x => x.homeAway === 'away');
      const st = ev.status || c.status;
      return {
        date: ev.date,
        state: st.type.state,
        comp: ev.shortName || '',
        home: { name: home.team.shortDisplayName || home.team.displayName, score: home.score, winner: home.winner },
        away: { name: away.team.shortDisplayName || away.team.displayName, score: away.score, winner: away.winner }
      };
    } catch (e) { return null; }
  }).filter(Boolean);
}

async function schedule(league, id) {
  try { return parseEvents(await jget(`${ESPN}/${league}/teams/${id}/schedule`)); }
  catch (e) { return []; }
}

function fmt(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

async function buildDigest() {
  const now = Date.now();
  const weekAhead = now + 7 * 864e5;
  const weekAgo = now - 7 * 864e5;

  const sources = [...CLUBS];
  // USMNT
  let usa = await schedule('fifa.world', '660');
  if (!usa.length) usa = await schedule('usa.1', '660');
  usa.forEach(e => { e._tag = 'USA'; });

  const all = [];
  for (const s of sources) {
    const evs = await schedule(s.league, s.id);
    evs.forEach(e => { e._tag = s.label; e._focus = s.focus; all.push(e); });
  }
  usa.forEach(e => { e._focus = 'USA'; all.push(e); });

  const upcoming = all.filter(e => { const t = +new Date(e.date); return e.state === 'pre' && t >= now && t <= weekAhead; })
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const results = all.filter(e => { const t = +new Date(e.date); return e.state === 'post' && t >= weekAgo; })
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  // build text
  const lines = [];
  lines.push('THE YANK TANK — Weekly Brief');
  lines.push(new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }));
  lines.push('');

  lines.push(`THE WEEK AHEAD (${upcoming.length})`);
  if (upcoming.length) {
    upcoming.forEach(e => lines.push(`• [${e._tag}] ${e.home.name} v ${e.away.name} — ${fmt(e.date)}${e.comp ? ' · ' + e.comp : ''}`));
  } else lines.push('• Quiet week — no fixtures in the next 7 days.');
  lines.push('');

  lines.push(`RECENT RESULTS (${results.length})`);
  if (results.length) {
    results.forEach(e => lines.push(`• [${e._tag}] ${e.home.name} ${e.home.score}-${e.away.score} ${e.away.name}`));
  } else lines.push('• No results in the last 7 days.');

  const text = lines.join('\n');
  const html = '<pre style="font-family:ui-monospace,monospace;font-size:13px;line-height:1.5">' +
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>';
  return { text, html, upcoming: upcoming.length, results: results.length };
}

async function deliver(d) {
  const { RESEND_API_KEY, DIGEST_TO, DIGEST_FROM, DIGEST_WEBHOOK } = process.env;
  const out = [];

  if (DIGEST_WEBHOOK) {
    try {
      await fetch(DIGEST_WEBHOOK, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: d.text })
      });
      out.push('webhook');
    } catch (e) { out.push('webhook-failed:' + e.message); }
  }

  if (RESEND_API_KEY && DIGEST_TO) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: DIGEST_FROM || 'onboarding@resend.dev',
          to: DIGEST_TO,
          subject: `Yank Tank — ${d.upcoming} games ahead, ${d.results} recent results`,
          html: d.html
        })
      });
      out.push('email');
    } catch (e) { out.push('email-failed:' + e.message); }
  }

  return out;
}

export default async function handler(req, res) {
  try {
    const d = await buildDigest();
    const sent = await deliver(d);
    res.status(200).json({ ok: true, delivered: sent, upcoming: d.upcoming, results: d.results, preview: d.text });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e) });
  }
}

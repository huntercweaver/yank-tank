// /api/player.js — Vercel serverless function
// Resolves a player name to an ESPN athlete and returns their season stats,
// as deep as ESPN exposes. Server-side so we can cache and avoid hammering
// ESPN from every browser. No API key, no cost.
//
// Query: ?name=Christian%20Pulisic&league=ita.1
//   league is a hint (the player's club league) to disambiguate.
//
// ESPN's public surfaces used:
//   - site search:  site.api.espn.com/apis/search/v2?query=...
//   - athlete page: site.web.api.espn.com/apis/common/v3/sports/soccer/{league}/athletes/{id}
//   - overview:     ...athletes/{id}/overview  (season splits, stats)

const HEADERS = { 'User-Agent': 'YankTank/1.0 (personal dashboard)' };

async function jget(url) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(url.split('?')[0] + ' ' + r.status);
  return r.json();
}

// Find an ESPN soccer athlete id by name.
async function resolveAthlete(name, leagueHint) {
  // ESPN site search returns mixed types; filter to soccer players.
  const url = `https://site.api.espn.com/apis/search/v2?query=${encodeURIComponent(name)}&limit=20`;
  let j;
  try { j = await jget(url); } catch (e) { return null; }
  const results = [];
  for (const group of (j.results || [])) {
    for (const item of (group.contents || group.items || [])) {
      const isPlayer = (item.type === 'player' || item.type === 'athlete') &&
        /soccer/i.test(item.sport || item.defaultLeagueSlug || item.link?.web || JSON.stringify(item.subType || ''));
      if (!isPlayer) continue;
      // try to dig out an id and league slug
      const id = item.id || (item.uid && item.uid.match(/a:(\d+)/)?.[1]) ||
        (item.link?.web && item.link.web.match(/id\/(\d+)/)?.[1]);
      const slug = (item.defaultLeagueSlug) ||
        (item.link?.web && item.link.web.match(/soccer\/([a-z]+\.\d+)/)?.[1]) || leagueHint;
      if (id) results.push({ id: String(id), league: slug || leagueHint, displayName: item.displayName || item.title || name });
    }
  }
  if (!results.length) return null;
  // prefer one matching the league hint
  return results.find(r => r.league === leagueHint) || results[0];
}

// Pull deep stats from the athlete overview (statistics splits) + bio.
async function fetchStats(athlete, leagueHint) {
  const league = athlete.league || leagueHint || 'eng.1';
  const base = `https://site.web.api.espn.com/apis/common/v3/sports/soccer/${league}/athletes/${athlete.id}`;
  const out = { id: athlete.id, league, name: athlete.displayName, stats: {}, bio: {} };

  // bio (age, position, height, etc.)
  try {
    const bio = await jget(base);
    const a = bio.athlete || bio;
    if (a) {
      out.name = a.displayName || out.name;
      out.bio = {
        age: a.age,
        position: a.position?.abbreviation || a.position?.name,
        height: a.displayHeight,
        weight: a.displayWeight,
        nationality: a.citizenship || a.birthPlace?.country,
        jersey: a.jersey
      };
    }
  } catch (e) { /* bio optional */ }

  // overview holds season statistics categories
  try {
    const ov = await jget(`${base}/overview`);
    // statistics block: categories of {name, displayValue}
    const cats = ov?.statistics?.splits || ov?.statistics?.categories || [];
    const flat = {};
    const walk = (arr) => {
      for (const c of (arr || [])) {
        if (Array.isArray(c.stats)) {
          for (const s of c.stats) {
            const key = (s.name || s.abbreviation || s.label || '').toString();
            if (key) flat[key] = s.displayValue ?? s.value;
          }
        }
        if (c.splits) walk(c.splits);
        if (c.categories) walk(c.categories);
      }
    };
    if (ov?.statistics?.displayName || ov?.statistics?.labels) {
      // alternate shape: parallel labels[] + stats[] arrays
      const labels = ov.statistics.labels || ov.statistics.names || [];
      const vals = (ov.statistics.splits?.[0]?.stats) || ov.statistics.stats || [];
      labels.forEach((lab, i) => { if (vals[i] != null) flat[lab] = vals[i]; });
    }
    walk(cats);
    out.stats = flat;
  } catch (e) { /* stats optional */ }

  return out;
}

// Normalize the messy ESPN stat keys to a friendly, ordered set.
function normalize(stats) {
  const pick = (...keys) => { for (const k of keys) { for (const sk of Object.keys(stats)) { if (sk.toLowerCase() === k.toLowerCase()) return stats[sk]; } } return null; };
  const friendly = {
    appearances: pick('appearances', 'gamesPlayed', 'GP', 'AP'),
    goals: pick('goals', 'totalGoals', 'G'),
    assists: pick('assists', 'goalAssists', 'A'),
    minutes: pick('minutes', 'minutesPlayed', 'MIN'),
    shots: pick('shots', 'totalShots', 'SH'),
    shotsOnTarget: pick('shotsOnTarget', 'shotsOnGoal', 'ST'),
    yellowCards: pick('yellowCards', 'YC'),
    redCards: pick('redCards', 'RC'),
    foulsCommitted: pick('foulsCommitted', 'FC'),
    saves: pick('saves', 'SV'),
    cleanSheets: pick('cleanSheet', 'cleanSheets', 'shutouts', 'SHO'),
    goalsConceded: pick('goalsConceded', 'GA')
  };
  // drop nulls
  const clean = {};
  for (const [k, v] of Object.entries(friendly)) if (v != null && v !== '' && v !== '0' || v === 0) clean[k] = v;
  return clean;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=10800, stale-while-revalidate=43200'); // 3h edge cache
  const { name = '', league = '' } = req.query;
  if (!name) { res.status(200).json({ ok: false, error: 'no name', stats: {} }); return; }
  try {
    const athlete = await resolveAthlete(name, league);
    if (!athlete) { res.status(200).json({ ok: false, name, error: 'not found', stats: {} }); return; }
    const data = await fetchStats(athlete, league);
    res.status(200).json({
      ok: true,
      name: data.name,
      id: data.id,
      league: data.league,
      bio: data.bio,
      stats: normalize(data.stats),
      raw: Object.keys(data.stats).length // count of raw fields found, for debugging
    });
  } catch (e) {
    res.status(200).json({ ok: false, name, error: String(e), stats: {} });
  }
}

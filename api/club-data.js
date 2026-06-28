// /api/club-data.js — Vercel serverless function
// Pulls "out on loan" players from a club's current Wikipedia season page,
// server-side (browsers can't, due to CORS). No API key, no cost.
//
// Query params:
//   ?club=mancity   -> loans for the mapped club
//
// Wikipedia exposes clean section wikitext via its REST/action API. We grab the
// "Out on loan" list, which clubs maintain on their season pages, and parse names.

// Map our club keys to the Wikipedia season-page titles. Update the season
// segment once a year (e.g. 2026-27). The function tries the configured title
// first, then falls back to the prior season if the new page doesn't exist yet.
const CLUB_WIKI = {
  mancity: { titles: ['2026\u201327_Manchester_City_F.C._season', '2025\u201326_Manchester_City_F.C._season'], name: 'Manchester City' },
  milan:   { titles: ['2026\u201327_AC_Milan_season', '2025\u201326_AC_Milan_season'], name: 'AC Milan' },
  psv:     { titles: ['2026\u201327_PSV_Eindhoven_season', '2025\u201326_PSV_Eindhoven_season'], name: 'PSV Eindhoven' }
};

async function fetchWikitext(title) {
  // action=parse returns parsed sections; we ask for wikitext of the whole page,
  // then slice the "Out on loan" block out of it.
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&formatversion=2`;
  const r = await fetch(url, { headers: { 'User-Agent': 'YankTank/1.0 (personal dashboard)' } });
  if (!r.ok) throw new Error('wiki ' + r.status);
  const j = await r.json();
  if (j.error || !j.parse) throw new Error('no page');
  return j.parse.wikitext;
}

// Pull player names out of the "Out on loan" section.
// Club season pages list loans with templates like {{Loan player|...}} or as
// rows containing [[Player Name]] plus a "to <Club>" phrase. We handle both.
function parseLoans(wikitext) {
  // isolate the Out on loan section (until the next == heading ==)
  const m = wikitext.match(/==+\s*Out on loan\s*==+([\s\S]*?)(?:\n==[^=]|$)/i);
  const block = m ? m[1] : '';
  if (!block) return [];

  const loans = [];
  const seen = new Set();

  // Pattern A: lines with a wikilinked name and a "to [[Club]]" / "at [[Club]]"
  const lineRe = /\[\[([^\]|]+?)(?:\|[^\]]+)?\]\][^\n]*?(?:to|at|joined)\s+\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/gi;
  let a;
  while ((a = lineRe.exec(block)) !== null) {
    const player = a[1].trim();
    const dest = a[2].trim();
    if (!seen.has(player) && !/season|loan|F\.C\.$/i.test(player)) {
      seen.add(player);
      loans.push({ player, dest });
    }
  }

  // Pattern B: bare wikilinked names in list items (fallback if "to club" not present)
  if (loans.length === 0) {
    const nameRe = /^\s*[\*#:]+\s*(?:\{\{[^}]*\}\}\s*)*\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/gim;
    let b;
    while ((b = nameRe.exec(block)) !== null) {
      const player = b[1].trim();
      if (!seen.has(player) && !/season|loan|list of/i.test(player)) {
        seen.add(player);
        loans.push({ player, dest: '' });
      }
    }
  }

  return loans.slice(0, 30);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=43200'); // cache 6h
  const { club = '' } = req.query;
  const cfg = CLUB_WIKI[club];
  if (!cfg) {
    res.status(200).json({ ok: false, error: 'unknown club', loans: [] });
    return;
  }

  let wikitext = null, usedTitle = null;
  for (const title of cfg.titles) {
    try { wikitext = await fetchWikitext(title); usedTitle = title; break; } catch (e) { /* try next */ }
  }

  if (!wikitext) {
    res.status(200).json({ ok: false, club, error: 'no season page found', loans: [] });
    return;
  }

  try {
    const loans = parseLoans(wikitext);
    res.status(200).json({ ok: true, club, name: cfg.name, source: usedTitle, count: loans.length, loans });
  } catch (e) {
    res.status(200).json({ ok: false, club, error: String(e), loans: [] });
  }
}

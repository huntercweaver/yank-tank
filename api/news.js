// /api/news.js — Vercel serverless function
// Fetches soccer RSS feeds server-side (browsers can't, due to CORS),
// filters for the user's clubs + USMNT, returns clean JSON.
// No API key, no cost. Runs on Vercel's free tier.
//
// Query params:
//   ?topic=club&team=Manchester%20City   -> headlines mentioning that club
//   ?topic=usmnt                          -> USMNT / US Soccer headlines
//   ?topic=transfers                      -> transfer-focused headlines
//
// Add or swap feeds in FEEDS below. All are public RSS endpoints.

const FEEDS = [
  // General + transfer-heavy soccer feeds (BBC, Guardian, Sky are reliable & CORS-irrelevant server-side)
  { name: 'BBC Football',      url: 'https://feeds.bbci.co.uk/sport/football/rss.xml' },
  { name: 'Guardian Football', url: 'https://www.theguardian.com/football/rss' },
  { name: 'Sky Sports',        url: 'https://www.skysports.com/rss/12040' },
  { name: 'ESPN Soccer',       url: 'https://www.espn.com/espn/rss/soccer/news' }
];

// Lightweight RSS/Atom parser — no dependencies.
function parseFeed(xml, sourceName) {
  const items = [];
  // handle both <item> (RSS) and <entry> (Atom)
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/(item|entry)>/gi) || [];
  for (const b of blocks) {
    const pick = (tag) => {
      const m = b.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      if (!m) return '';
      return m[1]
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&#8217;/g, '\u2019').replace(/&#039;/g, "'")
        .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .trim();
    };
    // Atom link is an attribute; RSS link is text
    let link = pick('link');
    if (!link) { const lm = b.match(/<link[^>]*href="([^"]+)"/i); if (lm) link = lm[1]; }
    const title = pick('title');
    const date = pick('pubDate') || pick('updated') || pick('published') || '';
    if (title) items.push({ title, link, date, source: sourceName, desc: pick('description').slice(0, 220) });
  }
  return items;
}

// Aliases so "Man City" matches "Manchester City", etc.
const ALIASES = {
  'Manchester City': ['manchester city', 'man city', 'mancity', 'pep', 'maresca', 'haaland', 'foden'],
  'AC Milan': ['ac milan', 'milan', 'pulisic', 'san siro', 'rossoneri'],
  'PSV Eindhoven': ['psv', 'eindhoven', 'pepi'],
};
const USMNT_TERMS = ['usmnt', 'us men', 'u.s. men', 'united states men', 'us soccer', 'u.s. soccer',
  'pulisic', 'pochettino', 'balogun', 'pepi', 'mckennie', 'tyler adams', 'weah', 'reyna',
  'gold cup', 'concacaf', 'copa america', 'nations league'];
const TRANSFER_TERMS = ['transfer', 'signing', 'signs', 'sign ', 'deal', 'bid', 'fee', 'move',
  'loan', 'medical', 'agree', 'target', 'linked', 'swoop', 'wages', 'contract'];

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800'); // cache 15 min at the edge
  const { topic = 'usmnt', team = '' } = req.query;

  try {
    const settled = await Promise.allSettled(
      FEEDS.map(async (f) => {
        const r = await fetch(f.url, { headers: { 'User-Agent': 'YankTank/1.0' } });
        if (!r.ok) throw new Error(f.name + ' ' + r.status);
        const xml = await r.text();
        return parseFeed(xml, f.name);
      })
    );

    let all = [];
    for (const s of settled) if (s.status === 'fulfilled') all = all.concat(s.value);

    // de-dupe by title
    const seen = new Set();
    all = all.filter((i) => { const k = i.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });

    const hay = (i) => (i.title + ' ' + i.desc).toLowerCase();
    let filtered;
    if (topic === 'club' && team) {
      const terms = ALIASES[team] || [team.toLowerCase()];
      filtered = all.filter((i) => terms.some((t) => hay(i).includes(t)));
    } else if (topic === 'transfers') {
      filtered = all.filter((i) => TRANSFER_TERMS.some((t) => hay(i).includes(t)));
    } else { // usmnt
      filtered = all.filter((i) => USMNT_TERMS.some((t) => hay(i).includes(t)));
    }

    // newest first when dates parse
    filtered.sort((a, b) => (new Date(b.date) - new Date(a.date)) || 0);

    res.status(200).json({ ok: true, topic, team, count: filtered.length, items: filtered.slice(0, 20) });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e), items: [] });
  }
}

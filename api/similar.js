import { tmdb, send } from "./_tmdb.js";
import { enrich } from "./_enrich.js";
import { aiConfigured, withFallback, chatCompletion } from "./_ai.js";

// When an AI key is set, the AI picks the closest matches (it judges tone, story and style far better
// than genre tags). Each pick is then checked against TMDB for ratings and where to watch.
async function aiPicks(type, d) {
  if (!aiConfigured()) return [];
  const title = d.title || d.name, year = (d.release_date || d.first_air_date || "").slice(0, 4);
  try {
    const { list } = await withFallback(async (p) => {
      const text = await chatCompletion(p, {
        model: p.textModel(),
        messages: [
          { role: "system", content: "You recommend films and series. Reply with only a JSON array, no other text." },
          { role: "user", content: `List the 10 ${type === "tv" ? "TV series" : "movies"} most similar to "${title}" (${year}) for someone who loved it: same tone, themes and style. Mix well-known and lesser-known picks, include Indian titles if they fit, and never include "${title}" itself. Format: [{"title":"exact official title","year":2014}]` },
        ],
        ...(p.extra ? p.extra("json") : {}),
      });
      const m = String(text).match(/\[[\s\S]*\]/);
      return { list: m ? JSON.parse(m[0]) : [] };
    });
    const hits = await Promise.all(list.slice(0, 10).map(async (x) => {
      const r = await tmdb(`/search/${type}`, { query: String(x.title || ""), [type === "movie" ? "year" : "first_air_date_year"]: x.year || undefined, include_adult: "false" }).catch(() => ({}));
      return r.results?.[0] || null;
    }));
    return hits.filter((h) => h && h.id !== d.id);
  } catch {
    return []; // AI unavailable or out of credit: TMDB signals still work
  }
}

// GET /api/similar?type=movie|tv&id=123
// "More like this" from three TMDB signals, ranked together:
//   1. recommendations: what people who liked this also liked (strongest)
//   2. titles sharing its themes (keywords) and main genre, well known and well rated
//   3. "similar": shared genres and keywords (weakest, used to top up)
// plus, when an AI key is set, the AI's picks, which rank first.
// Then ratings and where to watch in India for the best 12.
export default async function handler(req, res) {
  const type = req.query.type === "tv" ? "tv" : "movie";
  const id = parseInt(req.query.id, 10);
  if (!id) return send(res, 400, { error: "Missing title id." });
  try {
    const d = await tmdb(`/${type}/${id}`, { append_to_response: "keywords,recommendations,similar", language: "en-IN" });
    const genres = (d.genres || []).map((g) => g.id);
    const keywords = (type === "movie" ? d.keywords?.keywords : d.keywords?.results) || [];

    let themed = [];
    if (keywords.length) {
      const dq = await tmdb(`/discover/${type}`, {
        with_keywords: keywords.slice(0, 8).map((k) => k.id).join("|"),
        with_genres: genres[0] || undefined,
        sort_by: "vote_count.desc",
        "vote_count.gte": type === "movie" ? 300 : 80,
        include_adult: "false",
        language: "en-IN",
      }).catch(() => ({ results: [] }));
      themed = dq.results || [];
    }

    const score = new Map();
    const add = (list, weight, step) => list.forEach((r, i) => {
      if (r.id === id || !(r.poster_path || r.backdrop_path) || (r.vote_count || 0) < 20) return;
      const overlap = (r.genre_ids || []).filter((g) => genres.includes(g)).length;
      const s = weight - i * step + overlap * 0.5 + ((r.vote_average || 6) - 6) * 0.4;
      const cur = score.get(r.id);
      score.set(r.id, { r, s: (cur?.s || 0) + s }); // found by more than one signal = stronger match
    });
    add(await aiPicks(type, d), 6, 0.15);
    add(d.recommendations?.results || [], 3, 0.1);
    add(themed, 2.2, 0.08);
    add(d.similar?.results || [], 1, 0.05);

    const pool = [...score.values()].sort((a, b) => b.s - a.s).slice(0, 14).map((x) => x.r);
    const rows = (await Promise.all(pool.map((r) => enrich(type, r)))).filter(Boolean).slice(0, 12);
    send(res, 200, { results: rows }, 43200);
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
}

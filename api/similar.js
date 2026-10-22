import { tmdb, send } from "./_tmdb.js";
import { enrich } from "./_enrich.js";

// GET /api/similar?type=movie|tv&id=123
// "More like this" from three TMDB signals, ranked together:
//   1. recommendations: what people who liked this also liked (strongest)
//   2. titles sharing its themes (keywords) and main genre, well known and well rated
//   3. "similar": shared genres and keywords (weakest, used to top up)
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

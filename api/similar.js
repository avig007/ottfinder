import { tmdb, send } from "./_tmdb.js";
import { enrich, isRated } from "./_enrich.js";

// GET /api/similar?type=movie|tv&id=123
// Titles like this one: TMDB's recommendations (based on what people who liked it also liked),
// topped up with "similar" (shared genres and keywords), then ratings and where to watch in India.
export default async function handler(req, res) {
  const type = req.query.type === "tv" ? "tv" : "movie";
  const id = parseInt(req.query.id, 10);
  if (!id) return send(res, 400, { error: "Missing title id." });
  try {
    const [rec, sim] = await Promise.all([
      tmdb(`/${type}/${id}/recommendations`, { language: "en-IN" }).catch(() => ({ results: [] })),
      tmdb(`/${type}/${id}/similar`, { language: "en-IN" }).catch(() => ({ results: [] })),
    ]);
    const seen = new Set([id]);
    const pool = [...(rec.results || []), ...(sim.results || [])]
      .filter((r) => !seen.has(r.id) && seen.add(r.id))
      .filter((r) => (r.vote_count || 0) >= 20 && (r.poster_path || r.backdrop_path))
      .slice(0, 14);
    const rows = (await Promise.all(pool.map((r) => enrich(type, r)))).filter(Boolean);
    // Keep TMDB's relevance order, but let well-rated titles rise a little.
    const ranked = rows
      .map((r, i) => ({ r, k: i - (isRated(r) ? r.score / 20 : 0) }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.r)
      .slice(0, 12);
    send(res, 200, { results: ranked }, 43200);
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
}

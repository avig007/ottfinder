import { tmdb, send, img } from "./_tmdb.js";

// GET /api/search?q=disclosure day  -> top movie / TV matches
export default async function handler(req, res) {
  const q = (req.query.q || "").toString().trim();
  if (!q) return send(res, 400, { error: "Type a movie or series name." });
  try {
    const data = await tmdb("/search/multi", { query: q, include_adult: "false", language: "en-IN", region: "IN" });
    const results = (data.results || [])
      .filter((r) => r.media_type === "movie" || r.media_type === "tv")
      .slice(0, 8)
      .map((r) => ({
        id: r.id,
        type: r.media_type,
        title: r.title || r.name,
        year: (r.release_date || r.first_air_date || "").slice(0, 4),
        poster: img("w185", r.poster_path),
        overview: r.overview || "",
      }));
    send(res, 200, { results }, 3600);
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
}

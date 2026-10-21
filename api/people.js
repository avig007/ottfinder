import { tmdb, send, img } from "./_tmdb.js";

// GET /api/people?q=nolan&role=director|actor -> people for the actor / director filters
export default async function handler(req, res) {
  const q = (req.query.q || "").toString().trim();
  const role = req.query.role === "director" ? "Directing" : "Acting";
  if (q.length < 2) return send(res, 200, { results: [] });
  try {
    const data = await tmdb("/search/person", { query: q, include_adult: "false", language: "en-IN" });
    const results = (data.results || [])
      .sort((a, b) => (b.known_for_department === role) - (a.known_for_department === role) || b.popularity - a.popularity)
      .slice(0, 6)
      .map((p) => ({
        id: p.id,
        name: p.name,
        dept: p.known_for_department,
        photo: img("w185", p.profile_path),
        knownFor: (p.known_for || []).map((k) => k.title || k.name).filter(Boolean).slice(0, 2).join(", "),
      }));
    send(res, 200, { results }, 86400);
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
}

import { tmdb, send, img } from "./_tmdb.js";

// GET /api/search?q=...            -> titles + people, and whether the query names a person
// GET /api/search?q=...&suggest=1  -> short mixed list for the dropdown while typing
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

const shapeTitle = (r) => ({
  id: r.id,
  type: r.media_type,
  title: r.title || r.name,
  year: (r.release_date || r.first_air_date || "").slice(0, 4),
  poster: img("w185", r.poster_path),
});
const shapePerson = (r) => ({
  id: r.id,
  type: "person",
  name: r.name,
  dept: r.known_for_department === "Directing" ? "Director" : r.known_for_department === "Acting" ? "Actor" : r.known_for_department || "",
  photo: img("w185", r.profile_path),
  knownFor: (r.known_for || []).map((k) => k.title || k.name).filter(Boolean).slice(0, 2).join(", "),
  popularity: r.popularity || 0,
});

export default async function handler(req, res) {
  const q = (req.query.q || "").toString().trim().slice(0, 100);
  const suggest = req.query.suggest === "1";
  if (!q) return send(res, 400, { error: "Type a movie, series, actor or director." });
  try {
    const data = await tmdb("/search/multi", { query: q, include_adult: "false", language: "en-IN", region: "IN" });
    const raw = data.results || [];
    const titles = raw.filter((r) => r.media_type === "movie" || r.media_type === "tv").map(shapeTitle);
    const people = raw
      .filter((r) => r.media_type === "person" && (r.known_for_department === "Acting" || r.known_for_department === "Directing" || r.known_for_department === "Writing"))
      .map(shapePerson);

    // The query names a person when it matches their name and no title matches it exactly.
    const nq = norm(q);
    const exactTitle = titles.some((t) => norm(t.title) === nq);
    const top = raw[0]?.media_type === "person" ? people.find((p) => p.id === raw[0].id) : null;
    const nameWords = (p) => p.name.split(/\s+/).map(norm);
    const named = people.find((p) => norm(p.name) === nq) ||
      (q.trim().split(/\s+/).length >= 2 && people.find((p) => norm(p.name).startsWith(nq) && p.popularity > 3)) ||
      // One word like "nolan" or "tripathi": only when that person is TMDB's top result.
      (top && top.popularity > 5 && nameWords(top).includes(nq) ? top : null);
    const personMatch = !exactTitle && named ? named : null;

    if (suggest) {
      // Keep TMDB's relevance order, but cap people so titles stay visible.
      const out = [];
      let nPeople = 0;
      for (const r of raw) {
        if (out.length >= 7) break;
        if (r.media_type === "person") {
          const p = people.find((x) => x.id === r.id);
          if (p && nPeople < 3) { out.push(p); nPeople++; }
        } else if (r.media_type === "movie" || r.media_type === "tv") out.push(shapeTitle(r));
      }
      return send(res, 200, { results: out }, 86400);
    }

    send(res, 200, { results: titles.slice(0, 12), people: people.slice(0, 6), personMatch }, 3600);
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
}

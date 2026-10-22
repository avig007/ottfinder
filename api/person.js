import { tmdb, send, img } from "./_tmdb.js";
import { enrich, isRated } from "./_enrich.js";

// GET /api/person?id=525&role=auto|actor|director
// A person's work, ranked by IMDb + Rotten Tomatoes, with the Indian apps that include each title.
const SKIP_GENRES = new Set([10767, 10763, 10764]); // talk shows, news, reality
const self = (c) => /\b(self|himself|herself|themselves|host|narrator \(voice\))\b/i.test(c || "");

export default async function handler(req, res) {
  const id = parseInt(req.query.id, 10);
  if (!id) return send(res, 400, { error: "Missing person id." });
  try {
    const [p, c] = await Promise.all([
      tmdb(`/person/${id}`, { language: "en-IN" }),
      tmdb(`/person/${id}/combined_credits`, { language: "en-IN" }),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const released = (x) => {
      const d = x.release_date || x.first_air_date || "";
      return d && d <= today;
    };
    const dedupe = (list) => {
      const seen = new Map();
      for (const x of list) {
        const k = x.media_type + x.id;
        if (!seen.has(k)) seen.set(k, x);
      }
      return [...seen.values()];
    };
    const acting = dedupe((c.cast || []).filter((x) =>
      (x.media_type === "movie" || x.media_type === "tv") && released(x) && !self(x.character) &&
      !(x.genre_ids || []).some((g) => SKIP_GENRES.has(g)) && (x.vote_count || 0) >= 15));
    const directing = dedupe((c.crew || []).filter((x) =>
      (x.job === "Director" || x.job === "Creator") && released(x) && (x.vote_count || 0) >= 10));

    let role = req.query.role;
    if (role !== "actor" && role !== "director") {
      role = p.known_for_department === "Directing" && directing.length ? "director" : acting.length ? "actor" : "director";
    }
    const pool = (role === "director" ? directing : acting)
      .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0))
      .slice(0, 20);

    const rows = (await Promise.all(pool.map(async (x) => {
      const e = await enrich(x.media_type, x);
      return e && { ...e, role: role === "actor" ? x.character || "" : x.job === "Creator" ? "Creator" : "" };
    }))).filter(Boolean);
    rows.sort((a, b) => isRated(b) - isRated(a) || b.score - a.score);

    const bio = (p.biography || "").split(/\n+/)[0] || "";
    send(res, 200, {
      person: {
        id,
        name: p.name,
        photo: img("w342", p.profile_path),
        dept: p.known_for_department === "Directing" ? "Director" : p.known_for_department === "Acting" ? "Actor" : p.known_for_department || "",
        born: p.birthday ? p.birthday.slice(0, 4) : "",
        place: p.place_of_birth || "",
        bio: bio.length > 420 ? bio.slice(0, 400).replace(/\s+\S*$/, "") + "…" : bio,
      },
      role,
      roles: { actor: acting.length, director: directing.length },
      results: rows,
    }, 43200);
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
}

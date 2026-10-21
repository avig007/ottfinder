import { tmdb, send } from "./_tmdb.js";
import { ratingsFor, combinedScore } from "./_omdb.js";

// GET /api/recommend -> new movies and series (released in the last ~6 months),
// ranked by IMDb + Rotten Tomatoes, with the Indian OTT app they stream on.
// Cached at Vercel's edge for 12 hours, so OMDb is only hit a few dozen times a day.

const DAYS_BACK = 180;
const CANDIDATES = 14; // how many to fetch ratings for, per type
const SHOW = 10; // how many to show, per type

const isoDaysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

async function build(type) {
  const today = isoDaysAgo(0);
  const from = isoDaysAgo(DAYS_BACK);
  const dateKey = type === "movie" ? "primary_release_date" : "first_air_date";
  const list = await tmdb(`/discover/${type}`, {
    [`${dateKey}.gte`]: from,
    [`${dateKey}.lte`]: today,
    "vote_count.gte": type === "movie" ? 120 : 40,
    sort_by: "vote_average.desc",
    include_adult: "false",
    language: "en-IN",
  });

  const picks = (list.results || []).slice(0, CANDIDATES);
  const enriched = await Promise.all(
    picks.map(async (r) => {
      try {
        const d = await tmdb(`/${type}/${r.id}`, { append_to_response: "external_ids,watch/providers" });
        const imdbId = d.imdb_id || d.external_ids?.imdb_id;
        const ratings = await ratingsFor(imdbId);
        const IN = d["watch/providers"]?.results?.IN || {};
        const streamOn = (IN.flatrate || []).map((p) => p.provider_name).slice(0, 2);
        return {
          id: r.id,
          type,
          title: d.title || d.name,
          year: (d.release_date || d.first_air_date || "").slice(0, 4),
          poster: d.poster_path ? `https://image.tmdb.org/t/p/w342${d.poster_path}` : null,
          ratings,
          streamOn,
          score: combinedScore(ratings, r.vote_average),
        };
      } catch {
        return null;
      }
    })
  );
  // Titles with real IMDb/RT ratings first, then by score.
  const rated = (x) => (x.ratings && (x.ratings.imdb != null || x.ratings.rt != null) ? 1 : 0);
  return enriched
    .filter(Boolean)
    .sort((a, b) => rated(b) - rated(a) || b.score - a.score)
    .slice(0, SHOW);
}

export default async function handler(req, res) {
  try {
    const [movies, series] = await Promise.all([build("movie"), build("tv")]);
    send(res, 200, { movies, series, ratingsOn: !!process.env.OMDB_KEY }, 43200);
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
}

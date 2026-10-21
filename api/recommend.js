import { tmdb, send } from "./_tmdb.js";
import { ratingsFor, combinedScore } from "./_omdb.js";

// GET /api/recommend?type=movie|tv&genre=18&since=6m|1y|5y|all&actor=123&director=456&imdb=7&rt=75
// Top-rated titles for the home page, ranked by IMDb + Rotten Tomatoes, with the Indian app each is on.
// Each filter combination is cached at Vercel's edge for 12 hours.

const SHOW = 15;
const CANDIDATES = 24;
const WINDOWS = { "6m": 182, "1y": 365, "5y": 1826, all: null };
// Minimum TMDB votes so obscure titles with a handful of votes don't crowd the list.
const MIN_VOTES = {
  movie: { "6m": 100, "1y": 200, "5y": 1000, all: 3000 },
  tv: { "6m": 30, "1y": 60, "5y": 250, all: 600 },
};

const isoDaysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const dateOf = (r) => r.release_date || r.first_air_date || "";

// Titles from a person's filmography: actors via cast, directors via crew with job "Director".
async function creditsOf(personId, role, type) {
  const c = await tmdb(`/person/${personId}/combined_credits`, { language: "en-IN" });
  const list = role === "director" ? (c.crew || []).filter((x) => x.job === "Director") : c.cast || [];
  const byId = new Map();
  for (const x of list) if (x.media_type === type && !byId.has(x.id)) byId.set(x.id, x);
  return byId;
}

async function candidates({ type, genre, since, actor, director }) {
  const days = WINDOWS[since];
  const from = days ? isoDaysAgo(days) : null;
  const today = isoDaysAgo(0);

  if (actor || director) {
    const sets = await Promise.all([
      actor ? creditsOf(actor, "actor", type) : null,
      director ? creditsOf(director, "director", type) : null,
    ]);
    const [a, d] = sets;
    let list = [...(a || d).values()];
    if (a && d) list = list.filter((x) => d.has(x.id)); // both picked: titles they made together
    return list
      .filter((x) => dateOf(x) && dateOf(x) <= today && (!from || dateOf(x) >= from))
      .filter((x) => !genre || (x.genre_ids || []).includes(Number(genre)))
      .filter((x) => (x.vote_count || 0) >= 15)
      .sort((x, y) => y.vote_average - x.vote_average)
      .slice(0, CANDIDATES);
  }

  const dateKey = type === "movie" ? "primary_release_date" : "first_air_date";
  const params = {
    [`${dateKey}.lte`]: today,
    "vote_count.gte": MIN_VOTES[type][since],
    sort_by: "vote_average.desc",
    include_adult: "false",
    language: "en-IN",
    with_genres: genre || undefined,
  };
  if (from) params[`${dateKey}.gte`] = from;
  const pages = await Promise.all([1, 2].map((page) => tmdb(`/discover/${type}`, { ...params, page })));
  const seen = new Set();
  return pages
    .flatMap((p) => p.results || [])
    .filter((r) => !seen.has(r.id) && seen.add(r.id))
    .slice(0, CANDIDATES);
}

async function enrich(type, r) {
  try {
    const d = await tmdb(`/${type}/${r.id}`, { append_to_response: "external_ids,watch/providers" });
    const ratings = await ratingsFor(d.imdb_id || d.external_ids?.imdb_id);
    const IN = d["watch/providers"]?.results?.IN || {};
    return {
      id: r.id,
      type,
      title: d.title || d.name,
      year: dateOf(d).slice(0, 4),
      poster: d.poster_path ? `https://image.tmdb.org/t/p/w342${d.poster_path}` : null,
      ratings,
      streamOn: (IN.flatrate || []).map((p) => p.provider_name).slice(0, 2),
      score: combinedScore(ratings, r.vote_average),
    };
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const q = req.query;
  const f = {
    type: q.type === "tv" ? "tv" : "movie",
    genre: /^\d+$/.test(q.genre || "") ? q.genre : "",
    since: WINDOWS.hasOwnProperty(q.since) ? q.since : "6m",
    actor: /^\d+$/.test(q.actor || "") ? q.actor : "",
    director: /^\d+$/.test(q.director || "") ? q.director : "",
    imdb: parseFloat(q.imdb) || 0,
    rt: parseInt(q.rt, 10) || 0,
  };
  try {
    const pool = await candidates(f);
    const rows = (await Promise.all(pool.map((r) => enrich(f.type, r)))).filter(Boolean);
    const rated = (x) => (x.ratings && (x.ratings.imdb != null || x.ratings.rt != null) ? 1 : 0);
    const results = rows
      .filter((x) => !f.imdb || (x.ratings?.imdb ?? 0) >= f.imdb)
      .filter((x) => !f.rt || (x.ratings?.rt ?? -1) >= f.rt)
      .sort((a, b) => rated(b) - rated(a) || b.score - a.score)
      .slice(0, SHOW);
    send(res, 200, { results, ratingsOn: !!process.env.OMDB_KEY }, 43200);
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
}

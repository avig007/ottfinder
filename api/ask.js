import { guardedPost, fail } from "./_guard.js";
import { withFallback, chatCompletion } from "./_ai.js";
import { tmdb } from "./_tmdb.js";
import { enrich, isRated, applyRatingFilters } from "./_enrich.js";
import { classify } from "./_apps.js";

// POST /api/ask {q: "feel-good Malayalam movies on Netflix"} -> AI-planned results, checked against live data.
// The AI only plans the search (which titles, or which filters). Availability, prices and ratings
// always come from TMDB / JustWatch / OMDb, never from the AI's memory.

const GENRE_IDS = {
  movie: { action: 28, adventure: 12, animation: 16, comedy: 35, crime: 80, documentary: 99, drama: 18, family: 10751, fantasy: 14, history: 36, horror: 27, music: 10402, mystery: 9648, romance: 10749, "science fiction": 878, "sci-fi": 878, thriller: 53, war: 10752, western: 37 },
  tv: { action: 10759, adventure: 10759, animation: 16, comedy: 35, crime: 80, documentary: 99, drama: 18, family: 10751, fantasy: 10765, mystery: 9648, thriller: 9648, "science fiction": 10765, "sci-fi": 10765, kids: 10762, reality: 10764, war: 10768, politics: 10768, western: 37, romance: 18 },
};
const APPS = ["Netflix", "Prime Video", "JioHotstar", "Apple TV", "Sony LIV", "ZEE5"];

function systemPrompt() {
  const today = new Date().toISOString().slice(0, 10);
  return `You plan searches for OTT Finder, an app that shows where to watch movies and series in India. Today is ${today}.
Turn the user's request into a search plan. Reply with ONLY a JSON object, no other text:
{
  "understood": "the request restated in under 12 words",
  "strategy": "titles" or "discover",
  "type": "movie" | "tv" | "any",
  "titles": [{"title": "exact official title", "year": 2014, "type": "movie" | "tv", "why": "under 10 words: why it fits"}],
  "filters": {
    "genres": [from: Action, Adventure, Animation, Comedy, Crime, Documentary, Drama, Family, Fantasy, History, Horror, Music, Mystery, Romance, Science Fiction, Thriller, War],
    "language": ISO 639-1 code of the ORIGINAL language (hi, ml, ta, te, kn, bn, mr, en, ko, ja, es...) or null,
    "yearFrom": number or null, "yearTo": number or null,
    "minImdb": number or null, "minRt": number or null,
    "actors": [names], "directors": [names],
    "apps": [from: ${APPS.join(", ")}],
    "includedOnly": true if they want it included in their subscription / no extra payment, else false,
    "sort": "rating" | "popular" | "newest"
  }
}
Rules:
- "titles": when they describe a specific movie or show (plot, scene, character), ask for things "like X", or want a mood/theme that needs judgment. List 8 to 12 real titles, best match first. If they describe one specific title, put it first.
- "discover": when the request is mostly filters (genre, language, years, ratings, app, a movie director/actor), or asks for new/recent releases you may not know.
- For series with a specific actor or creator, use "titles".
- Always fill every filter that applies, in both strategies. "Hindi"/"Bollywood" means language hi.
- Never invent titles. Leave arrays empty and values null when not mentioned.`;
}

function parsePlan(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw fail(502, "bad_ai_reply", "The AI reply couldn't be read. Try rephrasing.");
  const p = JSON.parse(m[0]);
  const f = p.filters || {};
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
  return {
    understood: String(p.understood || "").slice(0, 120),
    strategy: p.strategy === "discover" ? "discover" : "titles",
    type: ["movie", "tv"].includes(p.type) ? p.type : "any",
    titles: (Array.isArray(p.titles) ? p.titles : []).slice(0, 12).map((t) => ({
      title: String(t.title || "").slice(0, 120), year: num(t.year), type: t.type === "tv" ? "tv" : t.type === "movie" ? "movie" : null, why: String(t.why || "").slice(0, 90),
    })).filter((t) => t.title),
    f: {
      genres: (f.genres || []).map((g) => String(g).toLowerCase()),
      language: typeof f.language === "string" && /^[a-z]{2}$/.test(f.language) ? f.language : null,
      yearFrom: num(f.yearFrom), yearTo: num(f.yearTo),
      minImdb: num(f.minImdb), minRt: num(f.minRt),
      actors: (f.actors || []).map(String).slice(0, 2), directors: (f.directors || []).map(String).slice(0, 2),
      apps: (f.apps || []).map((a) => classify(String(a), "", "").app).filter((a) => APPS.includes(a)),
      includedOnly: !!f.includedOnly,
      sort: ["rating", "popular", "newest"].includes(f.sort) ? f.sort : "rating",
    },
  };
}

// Find the TMDB entry for an AI-suggested title.
async function resolveTitle(t, fallbackType) {
  const type = t.type || (fallbackType !== "any" ? fallbackType : null);
  if (type) {
    const yearKey = type === "movie" ? "year" : "first_air_date_year";
    let r = await tmdb(`/search/${type}`, { query: t.title, [yearKey]: t.year || undefined, include_adult: "false" });
    if (!r.results?.length && t.year) r = await tmdb(`/search/${type}`, { query: t.title, include_adult: "false" });
    const hit = r.results?.[0];
    return hit ? { id: hit.id, type, vote_average: hit.vote_average } : null;
  }
  const r = await tmdb("/search/multi", { query: t.title, include_adult: "false" });
  const hit = (r.results || []).find((x) => x.media_type === "movie" || x.media_type === "tv");
  return hit ? { id: hit.id, type: hit.media_type, vote_average: hit.vote_average } : null;
}

const providerCache = {};
async function providerIds(type, apps) {
  if (!apps.length) return "";
  if (!providerCache[type]) providerCache[type] = (await tmdb(`/watch/providers/${type}`, { watch_region: "IN" })).results || [];
  const ids = providerCache[type]
    .filter((p) => !/channel/i.test(p.provider_name) && apps.includes(classify(p.provider_name, "", "").app))
    .map((p) => p.provider_id);
  return [...new Set(ids)].join("|");
}

async function personId(name) {
  const r = await tmdb("/search/person", { query: name, include_adult: "false" });
  return r.results?.[0]?.id || null;
}

async function discover(type, f) {
  const dateKey = type === "movie" ? "primary_release_date" : "first_air_date";
  const today = new Date().toISOString().slice(0, 10);
  const genreIds = [...new Set(f.genres.map((g) => GENRE_IDS[type][g]).filter(Boolean))];
  const params = {
    include_adult: "false",
    language: "en-IN",
    with_genres: genreIds.join(",") || undefined,
    with_original_language: f.language || undefined,
    [`${dateKey}.gte`]: f.yearFrom ? `${f.yearFrom}-01-01` : undefined,
    [`${dateKey}.lte`]: f.yearTo ? `${f.yearTo}-12-31` : today,
    sort_by: f.sort === "popular" ? "popularity.desc" : f.sort === "newest" ? `${dateKey}.desc` : "vote_average.desc",
    "vote_count.gte": f.sort === "newest" ? 5 : f.language && f.language !== "en" ? (type === "movie" ? 40 : 15) : type === "movie" ? 150 : 50,
  };
  const prov = await providerIds(type, f.apps);
  if (prov) {
    params.with_watch_providers = prov;
    params.watch_region = "IN";
    if (f.includedOnly || f.apps.length) params.with_watch_monetization_types = "flatrate|free|ads";
  }
  if (type === "movie") {
    const [cast, crew] = await Promise.all([
      Promise.all(f.actors.map(personId)), Promise.all(f.directors.map(personId)),
    ]);
    if (cast.filter(Boolean).length) params.with_cast = cast.filter(Boolean).join(",");
    if (crew.filter(Boolean).length) params.with_crew = crew.filter(Boolean).join(",");
  }
  const r = await tmdb(`/discover/${type}`, params);
  return (r.results || []).slice(0, 16).map((x) => ({ id: x.id, type, vote_average: x.vote_average }));
}

function describe(f, type) {
  const c = [];
  if (type !== "any") c.push(type === "tv" ? "Series" : "Movies");
  if (f.genres.length) c.push(f.genres.map((g) => g[0].toUpperCase() + g.slice(1)).join(", "));
  if (f.language) c.push(new Intl.DisplayNames(["en"], { type: "language" }).of(f.language) || f.language);
  if (f.yearFrom || f.yearTo) c.push(f.yearFrom && f.yearTo ? `${f.yearFrom}–${f.yearTo}` : f.yearFrom ? `${f.yearFrom} onwards` : `Up to ${f.yearTo}`);
  if (f.minImdb) c.push(`IMDb ${f.minImdb}+`);
  if (f.minRt) c.push(`RT ${f.minRt}%+`);
  for (const a of f.actors) c.push(a);
  for (const d of f.directors) c.push(`Dir. ${d}`);
  if (f.apps.length) c.push(`On ${f.apps.join(" / ")}`);
  else if (f.includedOnly) c.push("In a subscription");
  return c;
}

export default guardedPost(async (body) => {
  const q = String(body.q || "").trim().slice(0, 300);
  if (q.length < 2) throw fail(400, "bad_request", "Type or say what you're looking for.");

  const { plan, provider } = await withFallback(async (p) => {
    const text = await chatCompletion(p, {
      model: p.textModel(),
      messages: [{ role: "system", content: systemPrompt() }, { role: "user", content: q }],
      ...(p.extra ? p.extra("json") : {}),
    });
    return { plan: parsePlan(text) };
  });

  const f = plan.f;
  let pool = [];
  let strategy = plan.strategy;
  if (strategy === "titles" && plan.titles.length) {
    const hits = await Promise.all(plan.titles.map((t) => resolveTitle(t, plan.type).then((h) => h && { ...h, why: t.why }).catch(() => null)));
    const seen = new Set();
    pool = hits.filter((h) => h && !seen.has(h.type + h.id) && seen.add(h.type + h.id));
  } else {
    strategy = "discover";
    const types = plan.type === "any" ? ["movie", "tv"] : [plan.type];
    const lists = await Promise.all(types.map((t) => discover(t, f)));
    // Interleave movies and series when both were asked for.
    for (let i = 0; i < 16; i++) for (const l of lists) if (l[i]) pool.push(l[i]);
    pool = pool.slice(0, 16);
  }

  let rows = (await Promise.all(pool.map(async (h) => {
    const e = await enrich(h.type, h);
    return e && { ...e, why: h.why || "" };
  }))).filter(Boolean);

  // Apply what the AI can't know: live ratings and which apps include it in India.
  const all = rows;
  rows = applyRatingFilters(rows, f.minImdb, f.minRt);
  if (f.apps.length) rows = rows.filter((r) => r.streamOn.some((a) => f.apps.includes(classify(a, "", "").app)));
  else if (f.includedOnly) rows = rows.filter((r) => r.streamOn.length);
  if (strategy === "discover") rows.sort((a, b) => isRated(b) - isRated(a) || b.score - a.score);

  let note = "";
  if (!rows.length && all.length) {
    note = f.apps.length || f.includedOnly
      ? `None of the matches are included with ${f.apps.join(" or ") || "a subscription"} in India right now. Here are the closest matches.`
      : "None of the matches meet the rating you asked for. Here are the closest matches.";
    rows = all;
  }

  return {
    understood: plan.understood,
    chips: describe(f, plan.type),
    strategy,
    note,
    results: rows.slice(0, 12),
    provider,
  };
});

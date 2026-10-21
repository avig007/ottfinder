// Shared by the home-page picks and AI search: adds ratings and the Indian apps that include a title.
import { tmdb, img } from "./_tmdb.js";
import { ratingsFor, combinedScore } from "./_omdb.js";

const dateOf = (r) => r.release_date || r.first_air_date || "";

export async function enrich(type, r) {
  try {
    const d = await tmdb(`/${type}/${r.id}`, { append_to_response: "external_ids,watch/providers" });
    const ratings = await ratingsFor(d.imdb_id || d.external_ids?.imdb_id);
    const IN = d["watch/providers"]?.results?.IN || {};
    return {
      id: r.id,
      type,
      title: d.title || d.name,
      year: dateOf(d).slice(0, 4),
      poster: img("w342", d.poster_path),
      backdrop: img("w780", d.backdrop_path),
      overview: d.overview || "",
      ratings,
      // Only apps where it's included in the normal subscription (not paid add-on channels).
      streamOn: [...new Set((IN.flatrate || [])
        .map((p) => p.provider_name)
        .filter((n) => !/channel/i.test(n))
        .map((n) => n.replace(/\s+with ads$/i, "").replace(/^Amazon Prime Video$/, "Prime Video")))].slice(0, 2),
      score: combinedScore(ratings, d.vote_average ?? r.vote_average),
    };
  } catch {
    return null;
  }
}

export const isRated = (x) => (x.ratings && (x.ratings.imdb != null || x.ratings.rt != null) ? 1 : 0);

export function applyRatingFilters(rows, minImdb, minRt) {
  return rows
    .filter((x) => !minImdb || (x.ratings?.imdb ?? 0) >= minImdb)
    .filter((x) => !minRt || (x.ratings?.rt ?? -1) >= minRt);
}

// IMDb + Rotten Tomatoes ratings via OMDb (free key: https://www.omdbapi.com/apikey.aspx).
// Needs OMDB_KEY in Vercel. If it's missing, ratings are simply left out.
// Kept in memory while the server stays warm, so repeat lookups don't use up the 1,000/day OMDb limit.
const cache = new Map();

export async function ratingsFor(imdbId) {
  const key = process.env.OMDB_KEY;
  if (!key || !imdbId) return null;
  const hit = cache.get(imdbId);
  if (hit && Date.now() - hit.at < 12 * 3600e3) return hit.value;
  const value = await fetchRatings(key, imdbId);
  if (value) cache.set(imdbId, { at: Date.now(), value });
  return value;
}

async function fetchRatings(key, imdbId) {
  try {
    const r = await fetch(`https://www.omdbapi.com/?apikey=${key}&i=${imdbId}`);
    if (!r.ok) return null;
    const d = await r.json();
    if (d.Response !== "True") return null;
    const rt = (d.Ratings || []).find((x) => x.Source === "Rotten Tomatoes")?.Value || null;
    const imdb = d.imdbRating && d.imdbRating !== "N/A" ? parseFloat(d.imdbRating) : null;
    return {
      imdb,
      imdbVotes: d.imdbVotes && d.imdbVotes !== "N/A" ? d.imdbVotes : null,
      rt: rt ? parseInt(rt, 10) : null,
      imdbUrl: `https://www.imdb.com/title/${imdbId}/`,
    };
  } catch {
    return null;
  }
}

// One number to rank by: average of IMDb (scaled to 100) and Rotten Tomatoes, using whichever exist.
export function combinedScore(ratings, tmdbAverage) {
  const parts = [];
  if (ratings?.imdb != null) parts.push(ratings.imdb * 10);
  if (ratings?.rt != null) parts.push(ratings.rt);
  if (!parts.length && tmdbAverage) parts.push(tmdbAverage * 10);
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
}

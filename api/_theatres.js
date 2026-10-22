// Is a movie showing in Indian cinemas right now?
// Two signals: TMDB's "now playing in India" list, and the movie's own Indian theatrical release date
// (counted as still running for up to 6 weeks unless it has already come out on digital).
import { tmdb } from "./_tmdb.js";

const RUN_DAYS = 42;
let nowPlaying = { at: 0, ids: new Set() };

async function nowPlayingIds() {
  if (Date.now() - nowPlaying.at < 6 * 3600e3) return nowPlaying.ids;
  try {
    const pages = await Promise.all([1, 2, 3].map((page) =>
      tmdb("/movie/now_playing", { region: "IN", language: "en-IN", page }).catch(() => ({ results: [] }))));
    nowPlaying = { at: Date.now(), ids: new Set(pages.flatMap((p) => p.results || []).map((m) => m.id)) };
  } catch { /* keep the last list */ }
  return nowPlaying.ids;
}

const fmt = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// releaseDates: TMDB's release_dates.results for the movie.
// Returns {status: "now" | "soon", date, label} or null when it isn't in (or coming to) Indian cinemas.
export async function theatreStatus(movieId, releaseDates = []) {
  const IN = releaseDates.find((r) => r.iso_3166_1 === "IN")?.release_dates || [];
  const theatrical = IN.filter((r) => r.type === 2 || r.type === 3).map((r) => r.release_date.slice(0, 10)).sort()[0];
  const digital = IN.filter((r) => r.type >= 4).map((r) => r.release_date.slice(0, 10)).sort()[0];
  const today = new Date().toISOString().slice(0, 10);

  if (theatrical && theatrical > today) {
    const days = Math.round((Date.parse(theatrical) - Date.parse(today)) / 864e5);
    if (days <= 60) return { status: "soon", date: theatrical, label: `In theatres from ${fmt(theatrical)}` };
    return null;
  }
  const playing = (await nowPlayingIds()).has(movieId);
  const recent = theatrical && (Date.parse(today) - Date.parse(theatrical)) / 864e5 <= RUN_DAYS;
  const onDigital = digital && digital <= today;
  if (playing || (recent && !onDigital)) {
    return { status: "now", date: theatrical || null, label: theatrical ? `In theatres now · released ${fmt(theatrical)}` : "In theatres now" };
  }
  return null;
}

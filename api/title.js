import { tmdb, send } from "./_tmdb.js";
import { ratingsFor } from "./_omdb.js";

const LOGO = (p) => (p ? `https://image.tmdb.org/t/p/w92${p}` : null);

// Direct search links for the apps we know; anything else falls back to TMDB's watch page.
function appLink(name, title, fallback) {
  const q = encodeURIComponent(title);
  const n = name.toLowerCase();
  if (n.includes("netflix")) return `https://www.netflix.com/search?q=${q}`;
  if (n.includes("amazon") || n.includes("prime video")) return `https://www.primevideo.com/search?phrase=${q}`;
  if (n.includes("apple tv")) return `https://tv.apple.com/in/search?term=${q}`;
  if (n.includes("youtube")) return `https://www.youtube.com/results?search_query=${q}`;
  if (n.includes("google play")) return `https://play.google.com/store/search?q=${q}&c=movies`;
  if (n.includes("zee5")) return `https://www.zee5.com/search?q=${q}`;
  return fallback;
}

const COUNTRY = new Intl.DisplayNames(["en"], { type: "region" });

// GET /api/title?type=movie|tv&id=123  -> details + where to watch in India
export default async function handler(req, res) {
  const type = req.query.type === "tv" ? "tv" : "movie";
  const id = parseInt(req.query.id, 10);
  if (!id) return send(res, 400, { error: "Missing title id." });
  try {
    const d = await tmdb(`/${type}/${id}`, {
      language: "en-IN",
      append_to_response: type === "movie" ? "watch/providers,release_dates,external_ids" : "watch/providers,external_ids",
    });
    const title = d.title || d.name;
    const ratings = await ratingsFor(d.imdb_id || d.external_ids?.imdb_id);
    const all = d["watch/providers"]?.results || {};
    const IN = all.IN || {};
    const fallback = IN.link || `https://www.themoviedb.org/${type}/${id}/watch?locale=IN`;

    const group = (list = []) =>
      list
        .sort((a, b) => (a.display_priority ?? 99) - (b.display_priority ?? 99))
        .map((p) => ({ name: p.provider_name, logo: LOGO(p.logo_path), url: appLink(p.provider_name, title, fallback) }));

    const india = {
      stream: group(IN.flatrate),
      free: group([...(IN.free || []), ...(IN.ads || [])]),
      rent: group(IN.rent),
      buy: group(IN.buy),
    };
    const availableInIndia = Object.values(india).some((g) => g.length);

    // When it isn't in India, show where it does stream (subscription only, a few key markets first).
    let elsewhere = [];
    if (!availableInIndia) {
      const priority = ["US", "GB", "CA", "AU", "AE", "SG"];
      elsewhere = Object.entries(all)
        .filter(([cc, v]) => cc !== "IN" && v.flatrate?.length)
        .sort(([a], [b]) => (priority.indexOf(a) + 1 || 99) - (priority.indexOf(b) + 1 || 99))
        .slice(0, 6)
        .map(([cc, v]) => ({ country: COUNTRY.of(cc) || cc, apps: v.flatrate.map((p) => p.provider_name).slice(0, 4) }));
    }

    // Movie release status in India (theatrical vs digital) when known.
    let releaseNote = null;
    const rawDate = d.release_date || d.first_air_date || "";
    if (type === "movie") {
      const inRel = d.release_dates?.results?.find((r) => r.iso_3166_1 === "IN")?.release_dates || [];
      const digital = inRel.find((r) => r.type === 4);
      const theatrical = inRel.find((r) => r.type === 3 || r.type === 2);
      const today = new Date();
      const rel = new Date((theatrical?.release_date || rawDate) || 0);
      if (rawDate && rel > today) releaseNote = `Not released yet. Releases ${rel.toDateString().slice(4)}.`;
      else if (!availableInIndia && !digital && rawDate && today - rel < 1000 * 60 * 60 * 24 * 75)
        releaseNote = "Released recently. It may still be in theatres and not on OTT yet.";
    }

    send(
      res,
      200,
      {
        id,
        type,
        title,
        year: rawDate.slice(0, 4),
        overview: d.overview || "",
        poster: d.poster_path ? `https://image.tmdb.org/t/p/w342${d.poster_path}` : null,
        runtime: type === "movie" ? d.runtime : null,
        seasons: type === "tv" ? d.number_of_seasons : null,
        genres: (d.genres || []).map((g) => g.name).slice(0, 3),
        ratings,
        availableInIndia,
        india,
        elsewhere,
        releaseNote,
        moreLink: fallback,
      },
      21600
    );
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
}

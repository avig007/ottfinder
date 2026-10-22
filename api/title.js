import { tmdb, send, img } from "./_tmdb.js";
import { ratingsFor } from "./_omdb.js";
import { justwatchOffers } from "./_justwatch.js";
import { groupByApp, verdict, classify } from "./_apps.js";
import { trailerUrl } from "./_enrich.js";
import { theatreStatus } from "./_theatres.js";

const COUNTRY = new Intl.DisplayNames(["en"], { type: "region" });

// TMDB offers, used when JustWatch can't be reached. Same categories, no prices or direct links.
function tmdbOffers(IN) {
  const map = { flatrate: "FLATRATE", free: "FREE", ads: "ADS", rent: "RENT", buy: "BUY" };
  return Object.entries(map).flatMap(([k, m]) =>
    (IN[k] || []).map((p) => ({ monetization: m, name: p.provider_name, tech: "", value: null }))
  );
}

// GET /api/title?type=movie|tv&id=123 -> details, ratings, and what it costs to watch in India
export default async function handler(req, res) {
  const type = req.query.type === "tv" ? "tv" : "movie";
  const id = parseInt(req.query.id, 10);
  if (!id) return send(res, 400, { error: "Missing title id." });
  try {
    const d = await tmdb(`/${type}/${id}`, {
      language: "en-IN",
      append_to_response:
        type === "movie"
          ? "watch/providers,release_dates,external_ids,credits,videos"
          : "watch/providers,external_ids,aggregate_credits,videos",
    });
    const title = d.title || d.name;
    const rawDate = d.release_date || d.first_air_date || "";
    const imdbId = d.imdb_id || d.external_ids?.imdb_id;
    const all = d["watch/providers"]?.results || {};
    const IN = all.IN || {};
    const fallbackUrl = IN.link || `https://www.themoviedb.org/${type}/${id}/watch?locale=IN`;

    const [ratings, jw] = await Promise.all([
      ratingsFor(imdbId),
      justwatchOffers({ title, year: parseInt(rawDate) || 0, type, tmdbId: id, imdbId }).catch(() => null),
    ]);

    let offers, priceSource;
    if (jw && jw.length) {
      offers = jw.map((o) => ({
        monetization: o.monetizationType,
        name: o.package?.clearName || "",
        tech: o.package?.technicalName || "",
        value: o.retailPriceValue ?? null,
        currency: o.currency,
        label: o.retailPrice,
        quality: o.presentationType && o.presentationType !== "_4K" ? o.presentationType : o.presentationType === "_4K" ? "4K" : null,
        url: o.standardWebURL || null,
      }));
      priceSource = "justwatch";
    } else {
      offers = tmdbOffers(IN);
      priceSource = jw === null ? "tmdb" : "justwatch";
    }

    const apps = groupByApp(offers, fallbackUrl, type === "tv");

    // App logos from TMDB's provider list, matched to the same app names.
    const logos = {};
    for (const k of ["flatrate", "free", "ads", "rent", "buy"])
      for (const p of IN[k] || []) {
        const c = classify(p.provider_name, "", "");
        if (!c.addon && !logos[c.app] && p.logo_path) logos[c.app] = img("w92", p.logo_path);
      }
    for (const a of apps) a.logo = logos[a.app] || null;

    // People: directors (or series creators) and top-billed cast.
    const crew = type === "movie" ? d.credits?.crew || [] : [];
    const makers = (type === "movie"
      ? crew.filter((c) => c.job === "Director")
      : d.created_by || []
    ).slice(0, 3).map((p) => ({ id: p.id, name: p.name }));
    const castSrc = type === "movie" ? d.credits?.cast || [] : d.aggregate_credits?.cast || [];
    const cast = castSrc.slice(0, 10).map((p) => ({
      id: p.id,
      name: p.name,
      role: p.character || p.roles?.[0]?.character || "",
      photo: img("w185", p.profile_path),
    }));

    // Trailer on YouTube, official ones first.
    const trailer = trailerUrl(d.videos?.results, title, rawDate.slice(0, 4));
    const theatres = type === "movie" ? await theatreStatus(id, d.release_dates?.results) : null;
    let summary = verdict(apps);
    // Not on any app but showing in cinemas: say that first.
    if (theatres?.status === "now" && (summary.kind === "no" || summary.kind === "extra"))
      summary = { kind: "theatre", text: summary.kind === "no" ? "In theatres in India now. Not on any OTT app yet." : "In theatres in India now. On OTT only if you pay extra." };
    else if (theatres?.status === "soon" && summary.kind === "no")
      summary = { kind: "theatre", text: `${theatres.label}. Not on any OTT app yet.` };
    const availableInIndia = apps.length > 0;

    // Not in India: where it streams abroad.
    let elsewhere = [];
    if (!availableInIndia) {
      const priority = ["US", "GB", "CA", "AU", "AE", "SG"];
      elsewhere = Object.entries(all)
        .filter(([cc, v]) => cc !== "IN" && v.flatrate?.length)
        .sort(([a], [b]) => (priority.indexOf(a) + 1 || 99) - (priority.indexOf(b) + 1 || 99))
        .slice(0, 6)
        .map(([cc, v]) => ({ country: COUNTRY.of(cc) || cc, apps: v.flatrate.map((p) => p.provider_name).slice(0, 4) }));
    }

    let releaseNote = null;
    if (type === "movie") {
      const inRel = d.release_dates?.results?.find((r) => r.iso_3166_1 === "IN")?.release_dates || [];
      const digital = inRel.find((r) => r.type === 4);
      const theatrical = inRel.find((r) => r.type === 3 || r.type === 2);
      const today = new Date();
      const rel = new Date(theatrical?.release_date || rawDate || 0);
      if (!theatres && rawDate && rel > today) releaseNote = `Not released yet. Releases ${rel.toDateString().slice(4)}.`;
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
        tagline: d.tagline || "",
        poster: img("w342", d.poster_path),
        backdrop: img("w1280", d.backdrop_path),
        makers,
        makerLabel: type === "movie" ? (makers.length > 1 ? "Directors" : "Director") : makers.length > 1 ? "Creators" : "Creator",
        cast,
        trailer,
        runtime: type === "movie" ? d.runtime : null,
        seasons: type === "tv" ? d.number_of_seasons : null,
        genres: (d.genres || []).map((g) => g.name).slice(0, 3),
        ratings,
        availableInIndia,
        summary,
        apps,
        priceSource,
        elsewhere,
        releaseNote,
        theatres,
        showtimes: theatres ? `https://www.google.com/search?q=${encodeURIComponent(`${title} movie showtimes near me`)}` : null,
      },
      21600
    );
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
}

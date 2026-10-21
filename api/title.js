import { tmdb, send } from "./_tmdb.js";
import { ratingsFor } from "./_omdb.js";
import { justwatchOffers } from "./_justwatch.js";
import { groupByApp, verdict } from "./_apps.js";

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
      append_to_response: type === "movie" ? "watch/providers,release_dates,external_ids" : "watch/providers,external_ids",
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
    const summary = verdict(apps);
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
        summary,
        apps,
        priceSource,
        elsewhere,
        releaseNote,
      },
      21600
    );
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
}

// Offers with prices for India from JustWatch (the same source TMDB uses, but with rent/buy prices
// and direct links). JustWatch has no official public API; this uses the GraphQL endpoint its own
// website calls, so treat it as best-effort: if it fails, the app falls back to TMDB data without prices.

const URL_ = "https://apis.justwatch.com/graphql";

const QUERY = `
query Search($filter: TitleFilter!, $country: Country!, $language: Language!, $first: Int!, $offerFilter: OfferFilter!) {
  popularTitles(country: $country, filter: $filter, first: $first, sortBy: POPULAR, sortRandomSeed: 0) {
    edges { node {
      objectType
      content(country: $country, language: $language) {
        title originalReleaseYear
        externalIds { imdbId tmdbId }
      }
      offers(country: $country, platform: WEB, filter: $offerFilter) {
        monetizationType presentationType retailPrice(language: $language) retailPriceValue currency
        standardWebURL elementCount
        package { packageId clearName technicalName }
      }
    } }
  }
}`;

async function search(title, objectType) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (OTT Finder personal app)" },
    body: JSON.stringify({
      query: QUERY,
      variables: {
        filter: { searchQuery: title, objectTypes: [objectType] },
        country: "IN",
        language: "en",
        first: 8,
        offerFilter: { bestOnly: false },
      },
    }),
  });
  if (!r.ok) throw new Error(`JustWatch ${r.status}`);
  const j = await r.json();
  if (j.errors?.length) throw new Error(j.errors[0].message);
  return (j.data?.popularTitles?.edges || []).map((e) => e.node);
}

// Returns the JustWatch offers for this exact title, or null when it can't be matched.
export async function justwatchOffers({ title, year, type, tmdbId, imdbId }) {
  const nodes = await search(title, type === "tv" ? "SHOW" : "MOVIE");
  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const node =
    nodes.find((n) => String(n.content?.externalIds?.tmdbId) === String(tmdbId)) ||
    (imdbId && nodes.find((n) => n.content?.externalIds?.imdbId === imdbId)) ||
    nodes.find((n) => norm(n.content?.title) === norm(title) && Math.abs((n.content?.originalReleaseYear || 0) - year) <= 1);
  return node ? node.offers || [] : null;
}

// Turns raw offers (JustWatch, or TMDB as a fallback) into one clear answer per app:
// included with the subscription, free, needs a paid add-on channel, or rent/buy at a price.

// Which app a package belongs to, and whether it is the app's subscription or its pay-per-title store.
function classify(name = "", tech = "", monetization) {
  const n = name.toLowerCase();
  const t = tech.toLowerCase();
  const channel = n.match(/^(.*?)\s+amazon channel$/i) || n.match(/^(.*?)\s+apple tv channel$/i);
  if (channel) {
    const host = /amazon/.test(n) ? "Prime Video" : "Apple TV";
    return { app: host, addon: name.replace(/\s+(Amazon|Apple TV) Channel$/i, "") };
  }
  if (/netflix/.test(n)) return { app: "Netflix" };
  if (/prime video|amazon prime|amazon video/.test(n) || t === "amazon" || t === "amazonprime") return { app: "Prime Video" };
  if (/hotstar/.test(n)) return { app: "JioHotstar" };
  if (/apple tv|itunes/.test(n) || t === "itunes" || t === "appletvplus") return { app: "Apple TV" };
  if (/sony ?liv/.test(n)) return { app: "Sony LIV" };
  if (/zee5/.test(n)) return { app: "ZEE5" };
  if (/google play/.test(n)) return { app: "Google Play Movies" };
  if (/youtube/.test(n)) return { app: "YouTube" };
  if (/jiocinema/.test(n)) return { app: "JioHotstar" };
  // Drop "with Ads" style suffixes so ad tiers merge into the same app.
  return { app: name.replace(/\s+(with|w\/)\s+ads$/i, "").replace(/\s+standard$/i, "") };
}

const ORDER = ["Netflix", "Prime Video", "JioHotstar", "Apple TV", "Sony LIV", "ZEE5"];

function formatPrice(o) {
  if (o.value == null) return null;
  if (o.currency === "INR") return "₹" + (Number.isInteger(o.value) ? o.value : o.value.toFixed(2));
  return o.label || `${o.currency} ${o.value}`;
}

// offers: [{monetization: FLATRATE|FREE|ADS|RENT|BUY, name, tech, value, currency, label, quality, url}]
export function groupByApp(offers, fallbackUrl, isTv) {
  const apps = new Map();
  const get = (app) => {
    if (!apps.has(app)) apps.set(app, { app, included: false, free: false, addons: new Set(), rent: [], buy: [], url: null });
    return apps.get(app);
  };
  for (const o of offers) {
    if (o.monetization === "CINEMA") continue;
    const c = classify(o.name, o.tech, o.monetization);
    const a = get(c.app);
    if (o.url && (!a.url || o.monetization === "FLATRATE")) a.url = o.url;
    if (c.addon) {
      if (o.monetization === "FLATRATE") a.addons.add(c.addon);
      else if (o.monetization === "RENT" || o.monetization === "BUY") (o.monetization === "RENT" ? a.rent : a.buy).push(o);
      continue;
    }
    // Prime Video's ad tier is the normal Prime membership, so it counts as included.
    if (o.monetization === "FLATRATE" || (o.monetization === "ADS" && c.app === "Prime Video")) a.included = true;
    else if (o.monetization === "FREE" || o.monetization === "ADS") a.free = true;
    else if (o.monetization === "RENT") a.rent.push(o);
    else if (o.monetization === "BUY") a.buy.push(o);
  }

  const cheapest = (list) => {
    const priced = list.filter((x) => x.value != null).sort((x, y) => x.value - y.value);
    if (!priced.length) return list.length ? { price: null } : null;
    const p = priced[0];
    return { price: formatPrice(p), quality: p.quality || null };
  };

  const out = [...apps.values()].map((a) => {
    const rent = cheapest(a.rent);
    const buy = cheapest(a.buy);
    let status, detail;
    if (a.included) {
      status = "included";
      detail = `Included with your ${a.app} subscription. No extra payment.`;
    } else if (a.free) {
      status = "free";
      detail = "Free to watch (may have ads). No subscription needed.";
    } else if (a.addons.size) {
      status = "addon";
      const names = [...a.addons].join(" or ");
      detail = `Not included in the standard ${a.app} plan. Needs the paid ${names} add-on channel inside ${a.app}.`;
    } else {
      status = "paid";
      detail = `Not included in the ${a.app} subscription. You pay extra for this title.`;
    }
    return {
      app: a.app,
      status,
      detail,
      // Extra purchase options, even when the title is also included (e.g. buy to keep forever).
      rent: rent && { ...rent, unit: isTv ? "per season" : null },
      buy: buy && { ...buy, unit: isTv ? "per season" : null },
      addons: [...a.addons],
      url: a.url || fallbackUrl,
    };
  });

  const rank = { included: 0, free: 1, addon: 2, paid: 3 };
  return out.sort(
    (x, y) =>
      rank[x.status] - rank[y.status] ||
      (ORDER.indexOf(x.app) + 1 || 99) - (ORDER.indexOf(y.app) + 1 || 99)
  );
}

// Overall answer for the top of the page.
export function verdict(apps) {
  const inc = apps.filter((a) => a.status === "included").map((a) => a.app);
  const free = apps.filter((a) => a.status === "free").map((a) => a.app);
  const extra = apps.filter((a) => a.status === "addon" || a.status === "paid");
  if (inc.length) return { kind: "included", text: `Included with a ${inc.join(" / ")} subscription` };
  if (free.length) return { kind: "included", text: `Free to watch on ${free.join(", ")}` };
  if (extra.length) return { kind: "extra", text: "Not included in any subscription in India. You pay extra to watch it." };
  return { kind: "no", text: "Not available in India" };
}

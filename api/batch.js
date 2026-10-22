import { send } from "./_tmdb.js";
import { enrich } from "./_enrich.js";

// GET /api/batch?items=movie:27205,tv:66732  (up to 40)
// Live ratings, included-with apps, trailer and theatre status for the titles in a watchlist.
export default async function handler(req, res) {
  const items = String(req.query.items || "")
    .split(",")
    .map((s) => s.trim().match(/^(movie|tv):(\d+)$/))
    .filter(Boolean)
    .slice(0, 40)
    .map((m) => ({ type: m[1], id: +m[2] }));
  if (!items.length) return send(res, 400, { error: "No titles given." });
  try {
    const rows = await Promise.all(items.map((it) => enrich(it.type, it).catch(() => null)));
    send(res, 200, { results: rows.filter(Boolean) }, 21600);
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
}

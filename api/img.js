// GET /api/img?p=w342/abc.jpg -> the TMDB image, served from our domain and cached for a year.
const SIZES = new Set(["w92", "w154", "w185", "w300", "w342", "w500", "w780", "w1280", "original"]);

export default async function handler(req, res) {
  const p = (req.query.p || "").toString();
  const m = p.match(/^([a-z0-9]+)\/([A-Za-z0-9_-]+\.(jpg|jpeg|png|svg|webp))$/);
  if (!m || !SIZES.has(m[1])) return res.status(400).send("Bad image path");
  try {
    const r = await fetch(`https://image.tmdb.org/t/p/${m[1]}/${m[2]}`);
    if (!r.ok) return res.status(r.status).send("Image not found");
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", r.headers.get("content-type") || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable");
    res.status(200).send(buf);
  } catch {
    res.status(502).send("Image unavailable");
  }
}

// Shared TMDB helper. Needs TMDB_TOKEN (the "API Read Access Token") set in Vercel.
const BASE = "https://api.themoviedb.org/3";

export async function tmdb(path, params = {}) {
  const token = process.env.TMDB_TOKEN;
  if (!token) throw Object.assign(new Error("TMDB_TOKEN is not set in Vercel environment variables."), { status: 500 });
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, accept: "application/json" } });
  if (!r.ok) throw Object.assign(new Error(`TMDB error ${r.status}`), { status: r.status === 401 ? 500 : 502 });
  return r.json();
}

// TMDB images go through our own /api/img so they load even on networks that block TMDB (e.g. Jio).
export const img = (size, path) => (path ? `/api/img?p=${size}${path}` : null);

export function send(res, status, body, cacheSeconds = 0) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (cacheSeconds) res.setHeader("Cache-Control", `s-maxage=${cacheSeconds}, stale-while-revalidate=86400`);
  res.status(status).send(JSON.stringify(body));
}

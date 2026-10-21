// Shared helpers for the AI routes (voice + AI search).
export const env = (k, d = "") => (process.env[k] ?? d).trim();
export const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

// Light safety net: at most 60 AI requests per hour from one device, so a shared link can't run up your bill.
const hits = new Map();
function rateLimit(req) {
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  if (list.length >= 60) throw fail(429, "rate_limited", "Too many AI requests in the last hour. Try again a bit later.");
  list.push(now);
  hits.set(ip, list);
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

// Wraps a POST handler: parses JSON and turns errors into clear messages.
export function guardedPost(fn) {
  return async (req, res) => {
    try {
      if (req.method !== "POST") throw fail(405, "bad_request", "Use POST");
      rateLimit(req);
      const body = await readBody(req).catch(() => { throw fail(400, "bad_request", "Bad request body"); });
      sendJson(res, 200, await fn(body, req));
    } catch (e) {
      if (!e.code) console.error(e);
      sendJson(res, e.status || 500, { error: e.message || "Something went wrong", code: e.code || "server_error" });
    }
  };
}

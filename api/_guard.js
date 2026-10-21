// Protects the AI routes (voice + AI search) so only you can spend your AI credit.
// Set APP_PASSCODE in Vercel; the app asks for it once and remembers it on your phone.
import crypto from "node:crypto";

export const env = (k, d = "") => (process.env[k] ?? d).trim();
export const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

function passcodeOk(req) {
  const want = env("APP_PASSCODE");
  if (!want) throw fail(503, "not_configured", "AI isn't set up yet. Add APP_PASSCODE in Vercel (see README).");
  const got = String(req.headers["x-app-passcode"] || "");
  const a = crypto.createHash("sha256").update(want).digest();
  const b = crypto.createHash("sha256").update(got).digest();
  return crypto.timingSafeEqual(a, b);
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

// Wraps a POST handler: checks the passcode, parses JSON, and turns errors into clear messages.
export function guardedPost(fn) {
  return async (req, res) => {
    try {
      if (req.method !== "POST") throw fail(405, "bad_request", "Use POST");
      if (!passcodeOk(req)) throw fail(401, "bad_passcode", "Wrong passcode.");
      const body = await readBody(req).catch(() => { throw fail(400, "bad_request", "Bad request body"); });
      sendJson(res, 200, await fn(body, req));
    } catch (e) {
      if (!e.code) console.error(e);
      sendJson(res, e.status || 500, { error: e.message || "Something went wrong", code: e.code || "server_error" });
    }
  };
}

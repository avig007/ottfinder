// AI providers, tried in order: OpenAI → Gemini → Groq.
// A provider is skipped when its key isn't set. If one fails (out of credit, rate limit,
// bad key, outage), the request moves on to the next one automatically.
// Change the order with AI_ORDER, e.g. AI_ORDER=gemini,openai,groq
import { env, fail } from "./_guard.js";

const OAI_COMPAT = (name, base, keyVar, models, extra) => ({
  name,
  key: () => env(keyVar),
  chatUrl: `${base}/chat/completions`,
  sttUrl: `${base}/audio/transcriptions`,
  ...models,
  extra,
});

const PROVIDERS = {
  openai: OAI_COMPAT("openai", "https://api.openai.com/v1", "OPENAI_API_KEY", {
    textModel: () => env("OPENAI_TEXT_MODEL", "gpt-6-luna"),
    visionModel: () => env("OPENAI_VISION_MODEL", "gpt-6-luna"),
    sttModel: () => env("OPENAI_STT_MODEL", "gpt-4o-mini-transcribe"),
  }, () => ({ reasoning_effort: "low" })),
  gemini: OAI_COMPAT("gemini", "https://generativelanguage.googleapis.com/v1beta/openai", "GEMINI_API_KEY", {
    textModel: () => env("GEMINI_TEXT_MODEL", "gemini-3.5-flash-lite"),
    visionModel: () => env("GEMINI_VISION_MODEL", "gemini-3.5-flash-lite"),
    sttModel: () => env("GEMINI_STT_MODEL", "gemini-3.5-flash-lite"),
  }, () => ({ reasoning_effort: "low" })),
  groq: OAI_COMPAT("groq", "https://api.groq.com/openai/v1", "GROQ_API_KEY", {
    textModel: () => env("GROQ_TEXT_MODEL", "llama-3.3-70b-versatile"),
    visionModel: () => env("GROQ_VISION_MODEL", "qwen/qwen3.8-27b"),
    sttModel: () => env("GROQ_STT_MODEL", "whisper-large-v3-turbo"),
  }, (kind) => ({ temperature: kind === "chat" ? 0.5 : 0.2 })),
};

// A provider that just ran out of credit or rejected its key is rested for a while,
// so later requests go straight to the next one instead of waiting on a failure.
const resting = new Map(); // name -> until (ms)
const REST_MS = { ai_quota: 30 * 60_000, ai_key: 30 * 60_000, rate_limited: 60_000 };

export function chain() {
  const order = (env("AI_ORDER") || env("AI_PROVIDER") || "openai,gemini,groq").toLowerCase().split(",").map((s) => s.trim());
  for (const n of ["openai", "gemini", "groq"]) if (!order.includes(n)) order.push(n);
  const ready = order.filter((n) => PROVIDERS[n]?.key()).map((n) => PROVIDERS[n]);
  if (!ready.length) throw fail(500, "ai_key", "No AI key is set. Add OPENAI_API_KEY, GEMINI_API_KEY or GROQ_API_KEY in Vercel.");
  const now = Date.now();
  const isAwake = (p) => (resting.get(p.name) || 0) <= now;
  return [...ready.filter(isAwake), ...ready.filter((p) => !isAwake(p))]; // resting ones are tried last, not skipped
}

export const aiConfigured = () => !!(env("OPENAI_API_KEY") || env("GEMINI_API_KEY") || env("GROQ_API_KEY"));

function classify(p, status, msg) {
  if (status === 401 || status === 403) return fail(500, "ai_key", `${p.name} rejected the API key`);
  if (status === 402 || (status === 429 && /quota|billing|credit|exhaust|insufficient/i.test(msg))) return fail(402, "ai_quota", `${p.name}: ${msg}`);
  if (status === 429) return fail(429, "rate_limited", `${p.name}: ${msg}`);
  return Object.assign(fail(502, "upstream_error", `${p.name}: ${msg}`), { aiStatus: status });
}

// Runs fn(provider) on each provider in turn until one succeeds.
export async function withFallback(fn) {
  const errors = [];
  for (const p of chain()) {
    try {
      const out = await fn(p);
      resting.delete(p.name);
      return { ...out, provider: p.name };
    } catch (e) {
      if (e.code === "bad_request" || e.code === "image_rejected" || e.code === "audio_too_long") throw e; // our input, not the provider
      if (REST_MS[e.code]) resting.set(p.name, Date.now() + REST_MS[e.code]);
      errors.push(e);
      console.warn(`[ai] ${p.name} failed (${e.code}): ${e.message}`);
    }
  }
  // Every provider failed: report the most useful reason.
  const pick = errors.find((e) => e.code === "ai_quota") || errors.find((e) => e.code === "ai_key") || errors.find((e) => e.code === "rate_limited") || errors[errors.length - 1];
  throw Object.assign(fail(pick.status || 502, pick.code, errors.map((e) => e.message).join(" | ")), { aiStatus: pick.aiStatus });
}

export async function chatCompletion(p, body) {
  let r;
  try {
    r = await fetch(p.chatUrl, { method: "POST", headers: { Authorization: `Bearer ${p.key()}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch (e) {
    throw fail(502, "upstream_error", `${p.name}: network error`);
  }
  const j = await r.json().catch(() => ({}));
  const err = Array.isArray(j) ? j[0]?.error : j.error;
  if (!r.ok) throw classify(p, r.status, err?.message || `HTTP ${r.status}`);
  return j.choices?.[0]?.message?.content || "";
}

const GEMINI_AUDIO = { "audio/mp4": "audio/mp4", "audio/x-m4a": "audio/mp4", "audio/aac": "audio/aac", "audio/webm": "audio/webm", "audio/ogg": "audio/ogg", "audio/mpeg": "audio/mp3", "audio/wav": "audio/wav" };

export async function transcribe(p, buf, type, filename, prompt) {
  let r;
  if (p.name === "gemini") {
    // Gemini has no transcription endpoint; ask the model to transcribe the clip instead.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(p.sttModel())}:generateContent`;
    try {
      r = await fetch(url, {
        method: "POST",
        headers: { "x-goog-api-key": p.key(), "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [
            { text: `Transcribe this voice clip exactly as spoken (it may mix English and Hindi; write Hindi words in Roman letters). Reply with only the words spoken, no commentary. ${prompt || ""}` },
            { inline_data: { mime_type: GEMINI_AUDIO[type] || type, data: buf.toString("base64") } },
          ] }],
          generationConfig: { temperature: 0 },
        }),
      });
    } catch { throw fail(502, "upstream_error", "gemini: network error"); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw classify(p, r.status, j.error?.message || `HTTP ${r.status}`);
    return (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || "").join(" ").trim();
  }
  const form = new FormData();
  form.append("file", new Blob([buf], { type }), filename);
  form.append("model", p.sttModel());
  form.append("response_format", "json");
  if (prompt) form.append("prompt", prompt);
  try {
    r = await fetch(p.sttUrl, { method: "POST", headers: { Authorization: `Bearer ${p.key()}` }, body: form });
  } catch { throw fail(502, "upstream_error", `${p.name}: network error`); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw classify(p, r.status, j.error?.message || `HTTP ${r.status}`);
  return String(j.text || "").trim();
}

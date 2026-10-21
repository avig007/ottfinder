import { guardedPost, fail } from "./_guard.js";
import { withFallback, transcribe } from "./_ai.js";

// POST /api/transcribe {audio: base64, type: "audio/mp4"} -> {text}
const EXT = { "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "m4a", "audio/webm": "webm", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/wav": "wav" };
// Helps the speech model spell titles and names it would otherwise mishear.
const HINT =
  "Movie and series search: Netflix, Prime Video, JioHotstar, Apple TV, Sony LIV, ZEE5, IMDb, Rotten Tomatoes, " +
  "Panchayat, Mirzapur, Paatal Lok, Scam 1992, The Family Man, Kota Factory, Sacred Games, Bollywood, Malayalam, Tamil, Telugu, " +
  "Shah Rukh Khan, Pankaj Tripathi, Christopher Nolan, thriller, rom-com, sci-fi.";

export default guardedPost(async (body) => {
  const b64 = String(body.audio || "");
  if (!b64) throw fail(400, "bad_request", "No audio");
  if (b64.length > 4_000_000) throw fail(413, "audio_too_long", "Recording too long. Keep it under 30 seconds.");
  const type = String(body.type || "audio/mp4").split(";")[0];
  const buf = Buffer.from(b64, "base64");
  return withFallback(async (p) => ({ text: await transcribe(p, buf, type, `voice.${EXT[type] || "m4a"}`, HINT) }));
});

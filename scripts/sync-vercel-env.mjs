// Used by .github/workflows/sync-keys-to-vercel.yml. Never prints key values.
const { VERCEL_TOKEN, VERCEL_PROJECT, VERCEL_TEAM_ID, REDEPLOY } = process.env;
const KEYS = ["OPENAI_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY"];

if (!VERCEL_TOKEN) {
  // Not set up yet: skip quietly instead of failing every push (you can add keys directly in Vercel instead).
  console.log("::warning::VERCEL_TOKEN secret not set, so keys were not synced. Add it under Settings → Secrets and variables → Actions, or set the keys directly in Vercel.");
  process.exit(0);
}

const api = async (path, opts = {}) => {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`https://api.vercel.com${path}${sep}teamId=${VERCEL_TEAM_ID}`, {
    ...opts,
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${opts.method || "GET"} ${path} → ${r.status} ${j.error?.message || ""}`);
  return j;
};

const project = await api(`/v9/projects/${encodeURIComponent(VERCEL_PROJECT)}`);
console.log(`Vercel project: ${project.name} (${project.id})`);

let synced = 0;
for (const key of KEYS) {
  const value = (process.env[key] || "").trim();
  if (!value) { console.log(`- ${key}: not set in GitHub, skipped`); continue; }
  await api(`/v10/projects/${project.id}/env?upsert=true`, {
    method: "POST",
    body: JSON.stringify({ key, value, type: "encrypted", target: ["production", "preview"], comment: "Synced from GitHub secrets" }),
  });
  console.log(`- ${key}: synced`);
  synced++;
}
console.log(`${synced} key(s) synced.`);

if (REDEPLOY === "true") {
  const { deployments } = await api(`/v6/deployments?projectId=${project.id}&target=production&state=READY&limit=1`);
  const last = deployments?.[0];
  if (!last) { console.log("No production deployment yet; push to main to create one."); process.exit(0); }
  const d = await api(`/v13/deployments?forceNew=1`, {
    method: "POST",
    body: JSON.stringify({ name: project.name, deploymentId: last.uid, target: "production" }),
  });
  console.log(`Redeploy started: https://${d.url}`);
}

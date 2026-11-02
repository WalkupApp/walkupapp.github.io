// Walk-Up Songs promo code service (Cloudflare Worker + D1).
// Replaces the Google Apps Script + Google Sheet backend of walkupsongs.app/promo/.
//
//   POST /claim  {"platform":"ios"|"android"}  (no body = ios)
//                 -> {success:true, code, url, platform, remaining} | {success:false, error:"exhausted"|"limit"}
//   GET  /status  -> {total, claimed, remaining, ios:{...}, android:{...}}
//
// Codes are added and exported from the Mac with promo-service.sh (D1 API), so the Worker has no admin routes.

const ALLOWED_ORIGINS = ["https://walkupsongs.app", "https://www.walkupsongs.app"];
const MAX_PER_CLIENT_PER_DAY = 3;

function cors(request) {
  const origin = request.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(request, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(request) },
  });
}

async function clientHash(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const data = new TextEncoder().encode("walkup-promo:" + ip);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const PLATFORMS = ["ios", "android"];

async function remaining(env, platform) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM codes WHERE claimed_at IS NULL AND platform = ?1").bind(platform).first();
  return row ? row.n : 0;
}

async function requestedPlatform(request) {
  try {
    const body = await request.json();
    if (body && PLATFORMS.includes(body.platform)) return body.platform;
  } catch (e) {}
  return "ios";
}

async function claim(request, env) {
  const platform = await requestedPlatform(request);
  const client = await clientHash(request);
  const since = new Date(Date.now() - 86400000).toISOString();
  const used = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM codes WHERE client = ?1 AND claimed_at >= ?2").bind(client, since).first();
  if (used && used.n >= MAX_PER_CLIENT_PER_DAY) return json(request, { success: false, error: "limit" });

  // One statement, so two people can never get the same code.
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `UPDATE codes SET claimed_at = ?1, client = ?2
       WHERE code = (SELECT code FROM codes WHERE claimed_at IS NULL AND platform = ?3 ORDER BY rowid LIMIT 1)
     RETURNING code, url`).bind(now, client, platform).first();
  if (!row) return json(request, { success: false, error: "exhausted", platform });
  return json(request, { success: true, code: row.code, url: row.url, platform, remaining: await remaining(env, platform) });
}

async function status(request, env) {
  const { results } = await env.DB.prepare(
    "SELECT platform, COUNT(*) AS total, COUNT(claimed_at) AS claimed FROM codes GROUP BY platform").all();
  const out = { total: 0, claimed: 0, remaining: 0 };
  for (const p of PLATFORMS) out[p] = { total: 0, claimed: 0, remaining: 0 };
  for (const r of results) {
    out[r.platform] = { total: r.total, claimed: r.claimed, remaining: r.total - r.claimed };
    out.total += r.total; out.claimed += r.claimed; out.remaining += r.total - r.claimed;
  }
  return json(request, out);
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request) });
    try {
      if (pathname === "/claim" && request.method === "POST") return await claim(request, env);
      if (pathname === "/status" && request.method === "GET") return await status(request, env);
      return json(request, { error: "not found" }, 404);
    } catch (e) {
      return json(request, { success: false, error: "server" }, 500);
    }
  },
};

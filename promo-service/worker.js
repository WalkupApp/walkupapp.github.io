// Walk-Up Songs promo code service (Cloudflare Worker + D1).
// Replaces the Google Apps Script + Google Sheet backend of walkupsongs.app/promo/.
//
//   POST /claim   -> {success:true, code, url, remaining} | {success:false, error:"exhausted"|"limit"}
//   GET  /status  -> {total, claimed, remaining}
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

async function remaining(env) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM codes WHERE claimed_at IS NULL").first();
  return row ? row.n : 0;
}

async function claim(request, env) {
  const client = await clientHash(request);
  const since = new Date(Date.now() - 86400000).toISOString();
  const used = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM codes WHERE client = ?1 AND claimed_at >= ?2").bind(client, since).first();
  if (used && used.n >= MAX_PER_CLIENT_PER_DAY) return json(request, { success: false, error: "limit" });

  // One statement, so two people can never get the same code.
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `UPDATE codes SET claimed_at = ?1, client = ?2
       WHERE code = (SELECT code FROM codes WHERE claimed_at IS NULL ORDER BY rowid LIMIT 1)
     RETURNING code, url`).bind(now, client).first();
  if (!row) return json(request, { success: false, error: "exhausted" });
  return json(request, { success: true, code: row.code, url: row.url, remaining: await remaining(env) });
}

async function status(request, env) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS total, COUNT(claimed_at) AS claimed FROM codes").first();
  return json(request, { total: row.total, claimed: row.claimed, remaining: row.total - row.claimed });
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

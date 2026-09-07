#!/usr/bin/env node
/**
 * abcd local server — Phase 1, read-only.
 *
 * Safety spine, non-negotiable:
 *   - binds 127.0.0.1 only, never 0.0.0.0
 *   - GET only; there is no action endpoint in this phase
 *   - every path a reader touches is validated under $HOME
 *   - every request is written to an append-only audit log
 *
 * Serves the same AppState shape the synthetic fixture uses, so the UI renders
 * identical code against either source.
 */
import http from "node:http";
import { buildState } from "./core/state.mjs";
import { indexStats } from "./core/history.mjs";
import { audit, readAudit } from "./core/audit.mjs";

const PORT = Number(process.env.ABCD_PORT || 4499);
const HOST = "127.0.0.1";
const TTL_MS = Number(process.env.ABCD_TTL || 5000);

let cache = null;
let inflight = null;

async function getState(force = false) {
  const fresh = cache && !force && Date.now() - cache.at < TTL_MS;
  if (fresh) return cache.payload;
  if (inflight) return inflight;
  inflight = buildState()
    .then((payload) => { cache = { at: Date.now(), payload }; return payload; })
    .finally(() => { inflight = null; });
  return inflight;
}

const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(s),
    "cache-control": "no-store",
    // The UI is served by Vite on another port during development.
    "access-control-allow-origin": "http://localhost:4488",
  });
  res.end(s);
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  audit("http.request", { method: req.method, path: url.pathname });

  if (req.method !== "GET") return json(res, 405, { error: "read-only: GET only in this phase" });

  try {
    switch (url.pathname) {
      case "/api/health": {
        return json(res, 200, { ok: true, uptime: Math.round(process.uptime()), index: indexStats() });
      }
      case "/api/state": {
        const { state, meta } = await getState(url.searchParams.has("refresh"));
        return json(res, 200, { state, meta });
      }
      case "/api/meta": {
        const { meta } = await getState();
        return json(res, 200, meta);
      }
      case "/api/audit": {
        return json(res, 200, { entries: readAudit(100) });
      }
      default:
        return json(res, 404, { error: "not found" });
    }
  } catch (e) {
    audit("http.error", { path: url.pathname, message: String(e?.message || e) });
    return json(res, 500, { error: String(e?.message || e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`abcd core  →  http://${HOST}:${PORT}   (read-only, localhost only)`);
  audit("server.start", { port: PORT });
  getState().then((p) => console.log(`  warm: ${p.state.sessions.length} sessions, ${p.meta.index.days} days indexed`));
});

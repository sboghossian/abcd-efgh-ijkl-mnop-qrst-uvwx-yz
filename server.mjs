#!/usr/bin/env node
/**
 * abcd local server — Phase 2.
 *
 * Safety spine, non-negotiable:
 *   - binds 127.0.0.1 only, never 0.0.0.0
 *   - exactly ONE mutating endpoint, POST /api/action, behind a fixed whitelist
 *   - every path a reader or runner touches is validated under $HOME
 *   - every request and every settled action is appended to an audit log
 *   - anything that changes a file passes a fail-closed human gate first
 *
 * Serves the same AppState shape the synthetic fixture uses, so the UI renders
 * identical code against either source.
 */
import http from "node:http";
import path from "node:path";
import { buildState } from "./core/state.mjs";
import { indexStats } from "./core/history.mjs";
import { audit, readAudit } from "./core/audit.mjs";
import "./core/runtime/claude.mjs";
import { manager } from "./core/runtime/manager.mjs";
import { listRuntimes } from "./core/runtime/adapter.mjs";
import * as gate from "./core/runtime/gate.mjs";

const HOOK_PATH = path.resolve("core/runtime/gate-hook.mjs");

/** The only actions that exist. Anything not named here cannot be invoked. */
const ACTIONS = {
  "run.create": ({ cwd, prompt, model, runtimeId, incognito, permissionMode }) => {
    const settingsFile = gate.writeGateSettingsFile(`run_${Date.now()}`, HOOK_PATH);
    const run = manager.create({ runtimeId: runtimeId || "claude", cwd, prompt, model, incognito, permissionMode, settingsFile });
    run.start();
    return run.summary();
  },
  "run.send": ({ id, text }) => ({ sent: manager.get(id)?.send(text) ?? false }),
  "run.interrupt": ({ id }) => ({ interrupted: manager.get(id)?.interrupt() ?? false }),
  "run.end": ({ id }) => ({ ended: manager.get(id)?.end() ?? false }),
  "run.interruptAll": () => ({ interrupted: manager.interruptAll() }),
  "gate.decide": ({ id, decision, reason }) => gate.decide(id, decision, reason),
  "gate.revert": ({ snapshot, expectCurrentSha }) => gate.revertFile(snapshot, { expectCurrentSha }),
};

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

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "http://localhost:4488",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    return res.end();
  }

  if (req.method === "POST") {
    // Exactly one mutating endpoint, and it dispatches only from the whitelist.
    if (url.pathname !== "/api/action") return json(res, 405, { error: "the only mutating endpoint is POST /api/action" });
    let body = "";
    for await (const c of req) { body += c; if (body.length > 256_000) return json(res, 413, { error: "payload too large" }); }
    let parsed; try { parsed = JSON.parse(body || "{}"); } catch { return json(res, 400, { error: "invalid JSON" }); }
    const fn = ACTIONS[parsed.action];
    if (!fn) { audit("action.refused", { action: parsed.action }); return json(res, 400, { error: `unknown action "${parsed.action}"` }); }
    try {
      const result = await fn(parsed.params ?? {});
      audit("action.ok", { action: parsed.action });
      return json(res, 200, { ok: true, result });
    } catch (e) {
      audit("action.error", { action: parsed.action, message: String(e?.message || e) });
      return json(res, 400, { ok: false, error: String(e?.message || e) });
    }
  }

  if (req.method !== "GET") return json(res, 405, { error: "unsupported method" });

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
      case "/api/runs": {
        return json(res, 200, { runs: manager.list(), active: manager.active,
          runtimes: listRuntimes().map((r) => ({ id: r.id, label: r.label, capabilities: r.capabilities })) });
      }
      case "/api/gates": {
        return json(res, 200, { pending: gate.listPending() });
      }
      case "/api/events": {
        // Server-sent events: live run output without polling.
        res.writeHead(200, {
          "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive",
          "access-control-allow-origin": "http://localhost:4488",
        });
        const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
        send("hello", { at: new Date().toISOString() });
        const onEvent = (e) => send("run", e);
        const onState = (e) => send("state", e);
        const onDone = (e) => send("done", e);
        manager.on("event", onEvent); manager.on("state", onState); manager.on("done", onDone);
        const beat = setInterval(() => res.write(": keepalive\n\n"), 15_000);
        req.on("close", () => {
          clearInterval(beat);
          manager.off("event", onEvent); manager.off("state", onState); manager.off("done", onDone);
        });
        return;
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
  gate.ensureGateDirs();
  console.log(`abcd core  →  http://${HOST}:${PORT}   (localhost only · one gated action endpoint)`);
  audit("server.start", { port: PORT });
  getState().then((p) => console.log(`  warm: ${p.state.sessions.length} sessions, ${p.meta.index.days} days indexed`));
});

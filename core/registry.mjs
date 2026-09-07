/**
 * The live process registry: one file per running Claude Code CLI process.
 * This is what makes tier 2 possible — it carries a Unix socket path and an
 * auth key per session, so abcd can reach sessions it did not start.
 *
 * Read-only in Phase 1. Nothing here opens the socket.
 */
import { REGISTRY } from "./paths.mjs";
import path from "node:path";
import { readDir, readJson } from "./fsutil.mjs";

export async function readRegistry() {
  const out = new Map();
  for (const e of await readDir(REGISTRY)) {
    if (!e.isFile() || !e.name.endsWith(".json")) continue;
    const j = await readJson(path.join(REGISTRY, e.name));
    if (!j?.sessionId) continue;
    let alive = false;
    try { process.kill(j.pid, 0); alive = true; } catch { alive = false; }
    if (!alive) continue;
    out.set(j.sessionId, {
      pid: j.pid,
      cwd: j.cwd,
      startedAt: j.startedAt,
      version: j.version ?? null,
      entrypoint: j.entrypoint || "terminal",
      /** Tier 2 reachability. Private, undocumented IPC — never assumed stable. */
      hasSocket: Boolean(j.messagingSocketPath),
      socketPath: j.messagingSocketPath ?? null,
      name: j.name ?? null,
    });
  }
  return out;
}

/** Verified socket protocol versions. Anything else degrades to tier 3. */
export const VERIFIED_VERSIONS = ["2.1.178"];

export function tierFor(live) {
  if (!live) return 3;
  if (!live.hasSocket) return 1;
  const v = live.version ?? "";
  return VERIFIED_VERSIONS.some((ok) => v.startsWith(ok)) ? 2 : 1;
}

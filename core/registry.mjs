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

/** Peer protocol versions abcd knows how to speak. */
export const SUPPORTED_PEER_PROTOCOL = [1];
/** Features abcd needs before it will claim tier 2 reach. */
export const REQUIRED_PEER_FEATURES = [];

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
      startedAt: typeof j.startedAt === "number" ? new Date(j.startedAt).toISOString() : j.startedAt,
      version: j.version ?? null,
      entrypoint: j.entrypoint || "terminal",
      kind: j.kind ?? null,
      name: j.name ?? null,
      /**
       * The protocol carries its own version and capability list, so reach is
       * gated on THAT rather than on a CLI version string that goes stale the
       * moment the user updates.
       */
      peerProtocol: typeof j.peerProtocol === "number" ? j.peerProtocol : null,
      peerFeatures: Array.isArray(j.peerFeatures) ? j.peerFeatures : [],
      hasSocket: Boolean(j.messagingSocketPath),
      socketPath: j.messagingSocketPath ?? null,
      keyFile: await findKeyFile(j.pid),
      bridgeSessionId: j.bridgeSessionId ?? null,
    });
  }
  return out;
}

/** The peer token lives beside the registry entry, one file per pid. */
async function findKeyFile(pid) {
  for (const e of await readDir(REGISTRY)) {
    if (e.isFile() && e.name.startsWith(`${pid}.`) && e.name.endsWith(".key")) {
      return path.join(REGISTRY, e.name);
    }
  }
  return null;
}

/**
 * Tier is a claim about REACH, so it is derived from what the peer advertises,
 * never assumed. Unknown protocol means tier 1: abcd can still run its own
 * sessions, it just will not pretend it can write into this one.
 */
export function tierFor(live) {
  if (!live) return 3;
  if (!live.hasSocket || !live.keyFile) return 1;
  if (!SUPPORTED_PEER_PROTOCOL.includes(live.peerProtocol)) return 1;
  if (!REQUIRED_PEER_FEATURES.every((f) => live.peerFeatures.includes(f))) return 1;
  return 2;
}

/** Why a session is not tier 2, in words a person can act on. */
export function reachReason(live) {
  if (!live) return "not running — history only";
  if (!live.hasSocket) return "no messaging socket";
  if (!live.keyFile) return "no peer token on disk";
  if (!SUPPORTED_PEER_PROTOCOL.includes(live.peerProtocol)) {
    return `peer protocol ${live.peerProtocol ?? "unknown"} is not one abcd speaks (${SUPPORTED_PEER_PROTOCOL.join(", ")})`;
  }
  const missing = REQUIRED_PEER_FEATURES.filter((f) => !live.peerFeatures.includes(f));
  if (missing.length) return `peer is missing ${missing.join(", ")}`;
  return "reachable";
}

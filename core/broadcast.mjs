/**
 * Broadcast — one message to many sessions.
 *
 * Reach is not uniform, and the whole design here is refusing to pretend it is:
 *
 *   tier 1  a run abcd started   → delivered on its stdin
 *   tier 2  a session abcd found → reachable in principle, see canWrite()
 *   tier 3  history only         → not reachable, never silently dropped
 *
 * Every call returns per-target outcomes. A caller can always tell the
 * difference between "delivered", "refused" and "unreachable", because a
 * broadcast that quietly loses messages is worse than one that fails loudly.
 */
import { readRegistry, tierFor, reachReason } from "./registry.mjs";
import { manager } from "./runtime/manager.mjs";
import { audit } from "./audit.mjs";
import { recordWindDown, WIND_DOWN_DEFAULT, RESUME_DEFAULT } from "./day.mjs";

/**
 * Whether abcd will WRITE into a session it did not start.
 *
 * Off by default, and the reason is specific rather than general caution.
 * Claude Code documents the inbox socket itself — `CLAUDE_CODE_MESSAGING_SOCKET`,
 * `CLAUDE_CODE_MESSAGING_TOKEN`, and an optional first line of
 * `{"type":"auth","token":"..."}` on macOS and Linux. What it documents is a
 * script or hook posting into ITS OWN session's socket, as a child of that
 * session. The schema of the message line itself is not published, and abcd
 * does not guess a wire format it would be writing into someone's live work.
 *
 * For pushing external events into a session, Claude Code has a first-class
 * feature — channels — which is the supported route and the right place to
 * take this next. Until then abcd detects reach and reports it honestly.
 *
 * Note also that the receiving session governs this regardless: its
 * `crossSessionInbound` setting can accept, hold, or refuse anything that
 * arrives, and an unverified peer is held for approval in a session that
 * bypasses permission prompts.
 */
export const tier2WriteEnabled = () => process.env.ABCD_TIER2_WRITE === "1";

export async function targets() {
  const live = await readRegistry();
  const out = [];

  for (const r of manager.list()) {
    if (["done", "failed", "interrupted"].includes(r.state)) continue;
    out.push({ kind: "run", id: r.id, label: r.cwd, tier: 1, sessionId: r.sessionId, writable: true, reason: "started by abcd" });
  }

  const owned = new Set(manager.list().map((r) => r.sessionId).filter(Boolean));
  for (const [sessionId, l] of live) {
    if (owned.has(sessionId)) continue;
    const tier = tierFor(l);
    out.push({
      kind: "session", id: sessionId, label: l.name || sessionId.slice(0, 8),
      tier, sessionId, entrypoint: l.entrypoint, cwd: l.cwd,
      writable: tier === 2 && tier2WriteEnabled(),
      reason: tier === 2
        ? (tier2WriteEnabled() ? "peer write enabled" : "reachable, but abcd does not write into sessions it did not start")
        : reachReason(l),
    });
  }
  return out;
}

export async function broadcast(text, { only = null } = {}) {
  const all = await targets();
  const chosen = only ? all.filter((t) => only.includes(t.id)) : all;
  const results = [];

  for (const t of chosen) {
    if (!t.writable) { results.push({ ...t, outcome: "unreachable" }); continue; }
    if (t.kind === "run") {
      try { manager.require(t.id).send(text); results.push({ ...t, outcome: "delivered" }); }
      catch (e) { results.push({ ...t, outcome: "failed", error: String(e?.message || e) }); }
      continue;
    }
    // The transport is documented; the message schema is not. Channels are the
    // supported route for pushing an external event into a session.
    results.push({ ...t, outcome: "unreachable", error: "peer write not implemented — see channels" });
  }

  const delivered = results.filter((r) => r.outcome === "delivered").length;
  audit("broadcast", { chars: text.length, delivered, targets: results.length });
  return { text, delivered, unreachable: results.length - delivered, results };
}

export async function windDown(text = WIND_DOWN_DEFAULT) {
  const res = await broadcast(text);
  recordWindDown({ kind: "wind-down", delivered: res.delivered, unreachable: res.unreachable });
  return res;
}

export async function resumeAll(text = RESUME_DEFAULT) {
  const res = await broadcast(text);
  recordWindDown({ kind: "resume", delivered: res.delivered, unreachable: res.unreachable });
  return res;
}

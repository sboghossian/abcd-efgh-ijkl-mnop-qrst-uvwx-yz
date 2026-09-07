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
 * Off, and after checking every supported interface, currently unimplementable
 * rather than merely unimplemented. Written down so nobody re-investigates:
 *
 *   SendMessage / ListAgents  The documented cross-session mechanism. Exposed
 *                             only to Claude inside an agent's own tool loop;
 *                             there is no external API for a third-party app.
 *
 *   Peer inbox socket         Transport IS documented — CLAUDE_CODE_MESSAGING_SOCKET,
 *                             CLAUDE_CODE_MESSAGING_TOKEN, an optional
 *                             {"type":"auth","token":"..."} first line. What is
 *                             documented is a script posting into ITS OWN
 *                             session as a child of it. The message schema is
 *                             not published, and abcd will not guess a wire
 *                             format it would be writing into live work.
 *
 *   Channels                  Pushes external events into a running session,
 *                             which sounds exactly right — but a channel must
 *                             be opted in AT LAUNCH (`claude --channels
 *                             plugin:...`) and, during the research preview,
 *                             only from an Anthropic-maintained allowlist. You
 *                             cannot retrofit one into a session already
 *                             running, so it does not reach foreign sessions.
 *
 * So abcd detects reach and reports it honestly, and routes real work through
 * runs it owns, where it has full control over documented CLI flags.
 *
 * Channels remain interesting for a different job: a run abcd STARTS could be
 * launched with one, giving external events a way into that run. That is a
 * feature, not a fix for this.
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
        ? (tier2WriteEnabled() ? "peer write enabled" : "discoverable, but no supported interface writes into a session abcd did not start")
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
    // No supported interface exists for this; see the note on tier2WriteEnabled.
    results.push({ ...t, outcome: "unreachable", error: "no supported interface writes into a session abcd did not start" });
  }

  const delivered = results.filter((r) => r.outcome === "delivered").length;
  audit("broadcast", { chars: text.length, delivered, targets: results.length });
  return { text, delivered, unreachable: results.length - delivered, results };
}

export async function windDown(text = WIND_DOWN_DEFAULT, { only = null } = {}) {
  const res = await broadcast(text, { only });
  recordWindDown({ kind: "wind-down", delivered: res.delivered, unreachable: res.unreachable });
  return res;
}

export async function resumeAll(text = RESUME_DEFAULT, { only = null } = {}) {
  const res = await broadcast(text, { only });
  recordWindDown({ kind: "resume", delivered: res.delivered, unreachable: res.unreachable });
  return res;
}

/**
 * Typed client for the day loop and broadcast reach (core/day.mjs +
 * core/broadcast.mjs), served over HTTP by server.mjs on CORE_URL. Mirrors
 * the fetch/action pattern in lib/runs.ts: every read is try/caught to null
 * so a down server never throws, and every write goes through the single
 * POST /api/action whitelist and reports its own ok/error, independent of
 * the outer HTTP envelope.
 */
import { CORE_URL } from "./store";

export interface DayGroupCount {
  name: string;
  sessions: number;
}

/** What actually happened, read from the index — not from memory. */
export interface DayFacts {
  date: string;
  sessions: number;
  tokens: number;
  /** Derived from a public price table — never billed. Always render next to "est.". */
  costEstimateUsd: number;
  filesTouched: number;
  groups: DayGroupCount[];
  titles: string[];
}

/** Facts frozen at close time, plus whatever note the closer left. */
export interface DayReconciliation extends DayFacts {
  note: string | null;
}

export interface WindDownEntry {
  at: string;
  kind: "wind-down" | "resume";
  delivered: number;
  unreachable: number;
}

export interface Day {
  date: string;
  objective: string;
  openedAt: string | null;
  closedAt: string | null;
  reconciliation: DayReconciliation | null;
  windDowns: WindDownEntry[];
}

export interface DayResponse {
  day: Day;
  facts: DayFacts;
  recent: Day[];
}

/**
 * tier 1 — a run abcd started, writable
 * tier 2 — a session abcd found; reachable in principle, writable only when
 *          tier2Write is on
 * tier 3 — history only, never reachable
 *
 * Note: tier is a claim about reach as registry.mjs's tierFor() computes it,
 * not a promise about `kind`. A live session abcd did not start can still
 * land in the tier-1 bucket if it fails the peer-protocol check the same way
 * an unrecognised peer would — always trust each target's own `writable` and
 * `reason`, never infer them from the tier number alone.
 */
export type TargetTier = 1 | 2 | 3;
export type TargetKind = "run" | "session";

export interface ReachTarget {
  kind: TargetKind;
  id: string;
  label: string;
  tier: TargetTier;
  sessionId: string | null;
  entrypoint?: string;
  cwd?: string;
  writable: boolean;
  reason: string;
}

export interface TargetsResponse {
  targets: ReachTarget[];
  tier2Write: boolean;
}

export type BroadcastOutcome = "delivered" | "unreachable" | "failed";

export interface BroadcastResultItem extends ReachTarget {
  outcome: BroadcastOutcome;
  error?: string;
}

/**
 * `delivered` + `unreachable` always sum to `results.length` — the server
 * counts everything that did not land in `unreachable`, so a "failed" row
 * is counted there too. Read per-row `outcome` for the precise reason.
 */
export interface BroadcastResult {
  text: string;
  delivered: number;
  unreachable: number;
  results: BroadcastResultItem[];
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const r = await fetch(`${CORE_URL}${path}`, { signal });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export function fetchDay(signal?: AbortSignal): Promise<DayResponse | null> {
  return getJson<DayResponse>("/api/day", signal);
}

export function fetchTargets(signal?: AbortSignal): Promise<TargetsResponse | null> {
  return getJson<TargetsResponse>("/api/targets", signal);
}

/* ---------------- POST /api/action — the one whitelisted mutating endpoint ---------------- */

export interface ActionResult<T = unknown> {
  ok: boolean;
  result?: T;
  error?: string;
}

async function postAction<T = unknown>(action: string, params: Record<string, unknown>): Promise<ActionResult<T>> {
  try {
    const r = await fetch(`${CORE_URL}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, params }),
    });
    const body = (await r.json()) as { ok?: boolean; result?: T; error?: string };
    if (!r.ok) return { ok: false, error: body.error ?? `HTTP ${r.status}` };
    return { ok: body.ok ?? true, result: body.result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

export const dayOpen = (objective: string) => postAction<Day>("day.open", { objective });
export const dayObjective = (objective: string) => postAction<Day>("day.objective", { objective });
export const dayClose = (note: string) => postAction<Day>("day.close", { note });

/**
 * `only` scopes broadcast.send to specific target ids. broadcast.windDown
 * and broadcast.resume take no `only` on the server (core/broadcast.mjs
 * calls broadcast(text) directly, unfiltered) — they always reach every
 * target abcd can see, regardless of any selection made in the UI.
 */
export const broadcastSend = (text: string, only: string[]) =>
  postAction<BroadcastResult>("broadcast.send", { text, only });
export const broadcastWindDown = (text?: string) =>
  postAction<BroadcastResult>("broadcast.windDown", { text: text || undefined });
export const broadcastResume = (text?: string) =>
  postAction<BroadcastResult>("broadcast.resume", { text: text || undefined });

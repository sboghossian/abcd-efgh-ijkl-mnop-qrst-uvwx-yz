/**
 * Typed client for the Phase 2 run engine (core/runtime/manager.mjs + gate.mjs),
 * served over HTTP by server.mjs on CORE_URL. Mirrors the fetchCore() pattern in
 * store.tsx: every call is try/caught to null so a down server never throws.
 *
 * Two wrinkles in the wire format, both confirmed against the live server:
 *   - RunSummary.state can be "needs_approval" per manager.mjs's own lifecycle
 *     comment, but nothing in the current manager ever sets it — the gate flow
 *     leaves the run's state at "running" while a GateRequest sits in
 *     /api/gates. Kept in the union for forward-compat; the UI must not assume
 *     a pending gate implies this state.
 *   - SSE "run" events key the run as `runId`; SSE "state" and "done" events
 *     key it as `id` (state carries only the id, done carries the full
 *     summary). Not a typo to fix here — just two different event shapes.
 */
import { useEffect, useRef } from "react";
import type { PermissionMode } from "./types";
import { CORE_URL } from "./store";

export type RunState =
  | "idle"
  | "starting"
  | "running"
  | "awaiting_input"
  | "needs_approval"
  | "done"
  | "failed"
  | "interrupted";

/** Provider-shaped usage block, passed through verbatim from the runtime's result event. */
export type RunUsage = Record<string, unknown>;

export interface RunSummary {
  id: string;
  runtimeId: string;
  state: RunState;
  cwd: string;
  sessionId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  events: number;
  toolCalls: number;
  turns: number;
  /** Tail of the accumulated transcript text (server caps this at 4000 chars). */
  text: string;
  /**
   * The runtime's OWN figure (Claude Code's `total_cost_usd`) — measured, not
   * derived from a price table. Never label this "est." in the UI.
   */
  reportedCostUsd: number | null;
  usage: RunUsage | null;
  error: string | null;
  exitCode: number | null;
  incognito: boolean;
}

export interface RuntimeCapabilities {
  spawn: boolean;
  streamInput: boolean;
  interrupt: boolean;
  resume: boolean;
  fork: boolean;
  registry: boolean;
  gates: boolean;
  reportedCost: boolean;
  harness: boolean;
}

export interface RuntimeInfo {
  id: string;
  label: string;
  capabilities: RuntimeCapabilities;
}

export interface RunsResponse {
  runs: RunSummary[];
  active: number;
  runtimes: RuntimeInfo[];
}

export interface GateRequest {
  id: string;
  at: string;
  sessionId: string | null;
  cwd: string | null;
  tool: string;
  filePath: string | null;
  summary: string;
  command: string | null;
  input: Record<string, unknown>;
  /** Budget the hook was given before it defaults to deny. Milliseconds. */
  waitMs: number;
}

export interface GatesResponse {
  pending: GateRequest[];
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

export function fetchRuns(signal?: AbortSignal): Promise<RunsResponse | null> {
  return getJson<RunsResponse>("/api/runs", signal);
}

export function fetchGates(signal?: AbortSignal): Promise<GatesResponse | null> {
  return getJson<GatesResponse>("/api/gates", signal);
}

/* ---------------- POST /api/action — the one whitelisted mutating endpoint ---------------- */

export interface RunCreateParams {
  cwd: string;
  prompt: string;
  model?: string;
  runtimeId?: string;
  incognito?: boolean;
  permissionMode?: PermissionMode;
}

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

/**
 * Action results carry an inner payload as well as the outer envelope. An
 * unknown or stale run id now REJECTS with `{ok:false, error:"no such run ..."}`
 * rather than resolving with a falsy sentinel, so the outer envelope is
 * meaningful — but the inner value still says what actually happened, e.g.
 * `{ended:false}` when a run had already finished. Check both.
 */
export const runCreate = (params: RunCreateParams) => postAction<RunSummary>("run.create", { ...params });
export const runSend = (id: string, text: string) => postAction<{ sent: boolean }>("run.send", { id, text });
export const runInterrupt = (id: string) => postAction<{ interrupted: boolean }>("run.interrupt", { id });
export const runEnd = (id: string) => postAction<{ ended: boolean }>("run.end", { id });
export const runInterruptAll = () => postAction<{ interrupted: number }>("run.interruptAll", {});

/**
 * Continue a previous session. `fork` branches it into a new id instead of
 * appending, so an alternative can be explored without losing the original.
 * Refused by a runtime whose adapter declares it cannot do either.
 */
export const runResume = (params: {
  cwd: string; sessionId: string; prompt?: string; model?: string; runtimeId?: string; fork?: boolean;
}) => postAction<RunSummary>("run.resume", { ...params });

/** Same inner-sentinel wrinkle: an unknown gate id resolves `{ok:false, reason}` at HTTP 200. */
export type GateDecideResult =
  | { ok: true; id: string; decision: string; snapshot: unknown }
  | { ok: false; reason: string };

export const gateDecide = (id: string, decision: "allow" | "deny", reason = "") =>
  postAction<GateDecideResult>("gate.decide", { id, decision, reason });

/* ---------------- SSE — GET /api/events ---------------- */

/** Normalised per-line event kinds emitted by a runtime adapter (see adapter.mjs's EVENT map). */
export type RunEventKind =
  | "init"
  | "text"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "partial"
  | "status"
  | "hook"
  | "rate_limit"
  | "result"
  | "error";

/** The SSE "run" payload: one adapter event, tagged with the run it came from. */
export interface RunEvent {
  runId: string;
  kind: RunEventKind;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  summary?: string;
  phase?: "start" | "end";
  ok?: boolean;
  sessionId?: string | null;
  reportedCostUsd?: number | null;
  usage?: RunUsage | null;
  durationMs?: number | null;
  [key: string]: unknown;
}

/** The SSE "state" payload. Keyed by `id`, not `runId` — a different shape than "run". */
export interface RunStateEvent {
  id: string;
  state: RunState;
  [key: string]: unknown;
}

export interface RunEventHandlers {
  onRun?: (e: RunEvent) => void;
  onState?: (e: RunStateEvent) => void;
  onDone?: (e: RunSummary) => void;
  onOpen?: () => void;
  onLost?: () => void;
}

function parseSse<T>(raw: MessageEvent<string>): T | null {
  try {
    return JSON.parse(raw.data) as T;
  } catch {
    return null;
  }
}

/**
 * Subscribes to /api/events while `enabled` is true. Handlers are read from a
 * ref on every dispatch, so passing fresh inline callbacks each render never
 * tears down and reopens the EventSource. The browser's own SSE reconnect
 * (with backoff) handles a server that drops or was never up — onOpen/onLost
 * only report the current state, they never retry manually.
 */
export function useRunEvents(handlers: RunEventHandlers, enabled: boolean): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource(`${CORE_URL}/api/events`);
    es.addEventListener("hello", () => ref.current.onOpen?.());
    es.addEventListener("run", (ev) => {
      const data = parseSse<RunEvent>(ev as MessageEvent<string>);
      if (data) ref.current.onRun?.(data);
    });
    es.addEventListener("state", (ev) => {
      const data = parseSse<RunStateEvent>(ev as MessageEvent<string>);
      if (data) ref.current.onState?.(data);
    });
    es.addEventListener("done", (ev) => {
      const data = parseSse<RunSummary>(ev as MessageEvent<string>);
      if (data) ref.current.onDone?.(data);
    });
    es.onerror = () => ref.current.onLost?.();
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}

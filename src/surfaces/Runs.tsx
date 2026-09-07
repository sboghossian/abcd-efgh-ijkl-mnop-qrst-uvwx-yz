import "./Runs.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { relTime, clock, usd, shortPath } from "../lib/format";
import { fetchRuns, fetchGates, runCreate, runSend, runInterrupt, runEnd, gateDecide, useRunEvents } from "../lib/runs";
import type { RunSummary, RunState, RuntimeInfo, GateRequest, RunEvent } from "../lib/runs";

/**
 * Runs — the UI for the Phase 2 run engine (core/runtime/manager.mjs + gate.mjs).
 *
 * Two API quirks worth remembering while reading this file:
 *   - RunState includes "needs_approval" per manager.mjs's own lifecycle
 *     comment, but nothing in the current manager ever sets it — a pending
 *     gate leaves the run's own state at "running". So the gates banner and
 *     the run list are deliberately independent: a run can look "running"
 *     while it is, in fact, blocked on a human.
 *   - SSE "run" events carry `runId`; "state" and "done" events carry `id`
 *     for the same run. Handled in lib/runs.ts, not re-litigated here.
 */

const RUN_STATE_LABEL: Record<RunState, string> = {
  idle: "Idle",
  starting: "Starting",
  running: "Running",
  awaiting_input: "Awaiting input",
  needs_approval: "Needs approval",
  done: "Done",
  failed: "Failed",
  interrupted: "Interrupted",
};

const RUN_STATE_CLASS: Record<RunState, string> = {
  idle: "rs-idle",
  starting: "rs-idle",
  running: "rs-running",
  awaiting_input: "rs-waiting",
  needs_approval: "rs-waiting",
  done: "rs-done",
  failed: "rs-failed",
  interrupted: "rs-done",
};

const TERMINAL = new Set<RunState>(["done", "failed", "interrupted"]);
const MAX_BLOCKS = 400;
const POLL_MS = 3000;
const DEBOUNCE_MS = 350;

function mmss(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* ---------------- live output pane ---------------- */

interface OutputBlock {
  id: string;
  kind: "text" | "thinking" | "tool" | "system" | "error" | "divider";
  text?: string;
  name?: string;
  summary?: string;
}

function cap(blocks: OutputBlock[]): OutputBlock[] {
  return blocks.length > MAX_BLOCKS ? blocks.slice(blocks.length - MAX_BLOCKS) : blocks;
}

/** Folds one SSE run event into the block list, merging consecutive text/thinking deltas. */
function appendEvent(prev: OutputBlock[], e: RunEvent, nextId: () => string): OutputBlock[] {
  const last = prev[prev.length - 1];
  if (e.kind === "text" && e.text) {
    if (last && last.kind === "text") {
      const merged = prev.slice(0, -1);
      merged.push({ ...last, text: (last.text ?? "") + e.text });
      return merged;
    }
    return [...prev, { id: nextId(), kind: "text", text: e.text }];
  }
  if (e.kind === "thinking" && e.thinking) {
    if (last && last.kind === "thinking") {
      const merged = prev.slice(0, -1);
      merged.push({ ...last, text: (last.text ?? "") + e.thinking });
      return merged;
    }
    return [...prev, { id: nextId(), kind: "thinking", text: e.thinking }];
  }
  if (e.kind === "tool_use") {
    return [...prev, { id: nextId(), kind: "tool", name: e.name ?? "tool", summary: e.summary }];
  }
  if (e.kind === "hook") {
    const label = `permission check ${e.phase === "start" ? "started" : "finished"}${e.name ? ` — ${e.name}` : ""}`;
    return [...prev, { id: nextId(), kind: "system", text: label }];
  }
  if (e.kind === "init") {
    const sid = e.sessionId ? ` · ${e.sessionId.slice(0, 8)}` : "";
    return [...prev, { id: nextId(), kind: "system", text: `session started${sid}` }];
  }
  if (e.kind === "result") {
    return [...prev, { id: nextId(), kind: "divider" }];
  }
  if (e.kind === "error") {
    return [...prev, { id: nextId(), kind: "error", text: e.text ?? "error" }];
  }
  return prev;
}

function OutputBlockRow({ block }: { block: OutputBlock }) {
  switch (block.kind) {
    case "text":
      return <p className="ob-text prose">{block.text}</p>;
    case "thinking":
      return <p className="ob-thinking prose">{block.text}</p>;
    case "tool":
      return (
        <div className="ob-tool mono">
          <span className="chip">{block.name}</span>
          {block.summary && <span className="ob-tool-summary" title={block.summary}>{block.summary}</span>}
        </div>
      );
    case "system":
      return <p className="ob-system mono">{block.text}</p>;
    case "error":
      return <p className="ob-error mono">{block.text}</p>;
    case "divider":
      return <hr className="ob-divider" />;
    default:
      return null;
  }
}

function OutputPane({ run, blocks }: { run: RunSummary | null; blocks: OutputBlock[] }) {
  const paneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = paneRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [blocks]);

  if (!run) return <div className="empty panel-card">Select a run to see its live output.</div>;

  return (
    <div className="runs-output panel-card">
      <div className="runs-output-head">
        <span className="eyebrow">Live output</span>
        <span className="mono runs-output-id">{run.id}</span>
      </div>
      <div className="runs-output-body scroll" ref={paneRef} aria-live="polite">
        {blocks.length === 0 && <p className="runs-output-empty">No output yet.</p>}
        {blocks.map((b) => (
          <OutputBlockRow key={b.id} block={b} />
        ))}
      </div>
    </div>
  );
}

/* ---------------- pending gates — first, impossible to miss ---------------- */

function GateCard({
  gate,
  now,
  busyId,
  onDecide,
}: {
  gate: GateRequest;
  now: number;
  busyId: string | null;
  onDecide: (id: string, decision: "allow" | "deny") => void;
}) {
  const deadline = new Date(gate.at).getTime() + gate.waitMs;
  const remaining = deadline - now;
  const urgent = remaining < 15_000;
  const target = gate.filePath ? shortPath(gate.filePath) : gate.command || gate.summary || "(no target)";
  const busy = busyId === gate.id;

  return (
    <div className="gate-card">
      <div className="gate-top">
        <span className="chip gate-tool">{gate.tool}</span>
        <span className="mono gate-target" title={gate.filePath ?? gate.command ?? gate.summary}>
          {target}
        </span>
        <span
          className={`mono gate-countdown${urgent ? " urgent" : ""}`}
          title={`Requested ${relTime(gate.at)} ago; denies automatically at ${clock(new Date(deadline).toISOString())} if nobody decides`}
        >
          {remaining > 0 ? `auto-denies in ${mmss(remaining)}` : "denying now"}
        </span>
      </div>
      <div className="gate-meta mono">
        {gate.sessionId && <span>session {gate.sessionId.slice(0, 8)}</span>}
        {gate.cwd && <span>{shortPath(gate.cwd)}</span>}
        <span>waiting {relTime(gate.at)}</span>
      </div>
      <p className="gate-note">
        No decision here denies the tool call automatically when the countdown ends — silence is a denial, by design.
      </p>
      <div className="gate-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => onDecide(gate.id, "deny")}>
          Deny
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onDecide(gate.id, "allow")}>
          Approve
        </button>
      </div>
    </div>
  );
}

function GatesBanner({
  gates,
  now,
  busyId,
  onDecide,
}: {
  gates: GateRequest[];
  now: number;
  busyId: string | null;
  onDecide: (id: string, decision: "allow" | "deny") => void;
}) {
  return (
    <section className="runs-gates" role="region" aria-label="Pending permission gates">
      <div className="runs-gates-head">
        <span className="eyebrow">Pending gates · {gates.length}</span>
        <span className="mono runs-gates-note">These are blocking a tool call right now.</span>
      </div>
      <div className="runs-gates-list">
        {gates.map((g) => (
          <GateCard key={g.id} gate={g} now={now} busyId={busyId} onDecide={onDecide} />
        ))}
      </div>
    </section>
  );
}

/* ---------------- run list ---------------- */

function RunCostChip({ run }: { run: RunSummary }) {
  if (run.reportedCostUsd === null) return <span className="run-nocost">no cost reported yet</span>;
  return (
    <span>
      {usd(run.reportedCostUsd)}
      <span className="run-measured">measured</span>
    </span>
  );
}

function RunCard({
  run,
  runtime,
  selected,
  onSelect,
}: {
  run: RunSummary;
  runtime: RuntimeInfo | null;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`run-card${selected ? " selected" : ""}`}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
    >
      <div className="run-card-top">
        <span className={`dot ${RUN_STATE_CLASS[run.state]}`} />
        <span className="run-card-state">{RUN_STATE_LABEL[run.state]}</span>
        <span className="chip">{runtime?.label ?? run.runtimeId}</span>
        {run.incognito && <span className="chip s-incognito">incognito</span>}
      </div>
      <p className="mono run-card-cwd" title={run.cwd}>{shortPath(run.cwd)}</p>
      <div className="run-card-stats mono">
        <span>{run.turns} turn{run.turns === 1 ? "" : "s"}</span>
        <span>{run.toolCalls} tool call{run.toolCalls === 1 ? "" : "s"}</span>
        <span>{run.startedAt ? `${relTime(run.startedAt)} elapsed` : "not started"}</span>
        <RunCostChip run={run} />
      </div>
      {run.error && <p className="mono run-card-error">{run.error}</p>}
    </button>
  );
}

/* ---------------- selected-run detail + controls ---------------- */

function RunDetailHead({ run, runtime }: { run: RunSummary; runtime: RuntimeInfo | null }) {
  return (
    <div className="run-detail-head panel-card">
      <div className="run-detail-top">
        <span className={`dot ${RUN_STATE_CLASS[run.state]}`} />
        <h2>{RUN_STATE_LABEL[run.state]}</h2>
        <span className="chip">{runtime?.label ?? run.runtimeId}</span>
        {run.incognito && <span className="chip s-incognito">incognito</span>}
        <span className="mono run-detail-id">{run.id}</span>
      </div>
      <p className="mono run-detail-cwd" title={run.cwd}>{shortPath(run.cwd)}</p>
      <div className="run-detail-stats mono">
        <span>{run.turns} turn{run.turns === 1 ? "" : "s"}</span>
        <span>{run.toolCalls} tool call{run.toolCalls === 1 ? "" : "s"}</span>
        <span>{run.events} events</span>
        <span>{run.startedAt ? `started ${relTime(run.startedAt)} ago` : "not started"}</span>
        <RunCostChip run={run} />
        {run.sessionId && <span>session {run.sessionId.slice(0, 8)}</span>}
      </div>
      {run.error && <p className="mono run-detail-error">{run.error}</p>}
    </div>
  );
}

function RunControls({
  run,
  runtime,
  busyAction,
  onSend,
  onInterrupt,
  onEnd,
}: {
  run: RunSummary;
  runtime: RuntimeInfo | null;
  busyAction: string | null;
  onSend: (text: string) => void;
  onInterrupt: () => void;
  onEnd: () => void;
}) {
  const [text, setText] = useState("");
  const terminal = TERMINAL.has(run.state);
  const canStream = Boolean(runtime?.capabilities.streamInput);
  const canSend = !terminal && (run.state === "running" || run.state === "awaiting_input") && canStream;
  const canInterrupt = !terminal && run.state !== "idle";
  const canEnd = !terminal && run.state !== "idle";

  const sendTitle = terminal
    ? "This run has ended"
    : !canStream
      ? `${runtime?.label ?? run.runtimeId} cannot take streamed input`
      : canSend
        ? "Send a follow-up message"
        : "Only available while the run is running or awaiting input";
  const interruptTitle = terminal ? "This run has already ended" : canInterrupt ? "SIGINT — the run can recover, same as Ctrl-C" : "Nothing to interrupt yet";
  const endTitle = terminal ? "This run has already ended" : canEnd ? "Closes stdin so the run finishes cleanly" : "Nothing to end yet";

  return (
    <div className="run-controls">
      <form
        className="run-send"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSend || !text.trim()) return;
          onSend(text.trim());
          setText("");
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Send a follow-up…"
          disabled={!canSend}
          title={sendTitle}
        />
        <button type="submit" className="btn btn-primary" disabled={!canSend || !text.trim() || busyAction === "send"} title={sendTitle}>
          Send
        </button>
      </form>
      <div className="run-controls-row">
        <button type="button" className="btn" disabled={!canInterrupt || busyAction === "interrupt"} title={interruptTitle} onClick={onInterrupt}>
          Interrupt
        </button>
        <button type="button" className="btn" disabled={!canEnd || busyAction === "end"} title={endTitle} onClick={onEnd}>
          End
        </button>
      </div>
    </div>
  );
}

/* ---------------- new run form ---------------- */

function NewRunForm({
  defaultCwd,
  defaultModel,
  onCreated,
}: {
  defaultCwd: string;
  defaultModel: string;
  onCreated: (run: RunSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  const [cwd, setCwd] = useState(defaultCwd);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(defaultModel);
  const [incognito, setIncognito] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!cwd.trim() || !prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await runCreate({ cwd: cwd.trim(), prompt: prompt.trim(), model: model.trim() || undefined, incognito });
    setBusy(false);
    if (!res.ok || !res.result) {
      setError(res.error ?? "Failed to start run");
      return;
    }
    onCreated(res.result);
    setPrompt("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        New run
      </button>
    );
  }

  return (
    <form className="runs-new panel-card" onSubmit={submit}>
      <div className="runs-new-head">
        <span className="eyebrow">New run</span>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <label className="field">
        <span className="eyebrow">Working directory</span>
        <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="/Users/you/code/project" required />
      </label>
      <label className="field">
        <span className="eyebrow">Prompt</span>
        <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What should this run do?" required />
      </label>
      <label className="field">
        <span className="eyebrow">Model</span>
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="claude-sonnet-5" />
      </label>
      <label className="check">
        <input type="checkbox" checked={incognito} onChange={(e) => setIncognito(e.target.checked)} />
        <span>Incognito — writes no transcript, nothing resumable. Gone once the run ends.</span>
      </label>
      {error && <p className="mono runs-form-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !cwd.trim() || !prompt.trim()}>
          {busy ? "Starting…" : "Start run"}
        </button>
      </div>
      <p className="field-note">This spawns a real Claude Code process and bills real tokens on the runtime's own account.</p>
    </form>
  );
}

/* ---------------- surface ---------------- */

type ConnStatus = "checking" | "up" | "down";

export function Runs() {
  const { app } = useStore();
  const mountedRef = useRef(true);
  // Must be re-armed on every mount, not only initialised once: StrictMode
  // mounts, cleans up, then mounts again, and leaving this false strands every
  // later fetch. The same happens whenever the user navigates away and back.
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [connStatus, setConnStatus] = useState<ConnStatus>("checking");
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runtimes, setRuntimes] = useState<RuntimeInfo[]>([]);
  const [gates, setGates] = useState<GateRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [blocks, setBlocks] = useState<OutputBlock[]>([]);
  const [busyGate, setBusyGate] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const runsRef = useRef(runs);
  useEffect(() => { runsRef.current = runs; }, [runs]);

  const blockIdRef = useRef(0);
  const nextBlockId = useCallback(() => `b${blockIdRef.current++}`, []);

  const refreshAll = useCallback(async () => {
    const [r, g] = await Promise.all([fetchRuns(), fetchGates()]);
    if (!mountedRef.current) return;
    if (r) {
      setRuns(r.runs);
      setRuntimes(r.runtimes);
      setConnStatus("up");
    } else {
      setConnStatus("down");
    }
    if (g) setGates(g.pending);
  }, []);

  // Baseline poll — the safety net under the SSE-triggered refresh below, and
  // what recovers the surface automatically once a down server comes back.
  useEffect(() => {
    let stopped = false;
    const tick = () => { if (!stopped) refreshAll(); };
    tick();
    const t = window.setInterval(tick, POLL_MS);
    return () => { stopped = true; window.clearInterval(t); };
  }, [refreshAll]);

  // Drives gate countdowns and the "elapsed" figures on run cards.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const refreshTimer = useRef<number | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(refreshAll, DEBOUNCE_MS);
  }, [refreshAll]);
  useEffect(() => () => {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
  }, []);

  useRunEvents(
    {
      onRun: (e) => {
        if (e.runId === selectedId) setBlocks((prev) => cap(appendEvent(prev, e, nextBlockId)));
        // A PreToolUse hook starting is the signal a new gate just appeared —
        // there is no dedicated SSE event for /api/gates, so this is the fastest
        // available trigger short of shortening the base poll interval.
        scheduleRefresh();
      },
      onState: (e) => {
        setRuns((prev) => prev.map((r) => (r.id === e.id ? { ...r, state: e.state } : r)));
        scheduleRefresh();
      },
      onDone: (e) => {
        setRuns((prev) => (prev.some((r) => r.id === e.id) ? prev.map((r) => (r.id === e.id ? e : r)) : [e, ...prev]));
      },
    },
    true,
  );

  // Reseed the pane from the run's own accumulated text tail whenever the
  // selection changes; live SSE deltas append on top from that point on.
  useEffect(() => {
    const run = runsRef.current.find((r) => r.id === selectedId) ?? null;
    setBlocks(run?.text ? [{ id: nextBlockId(), kind: "text", text: run.text }] : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const active = useMemo(() => runs.filter((r) => !TERMINAL.has(r.state)), [runs]);
  const finished = useMemo(() => runs.filter((r) => TERMINAL.has(r.state)), [runs]);

  useEffect(() => {
    if (selectedId && runs.some((r) => r.id === selectedId)) return;
    const first = active[0] ?? runs[0];
    setSelectedId(first ? first.id : null);
  }, [runs, active, selectedId]);

  const runtimeById = useCallback((id: string) => runtimes.find((rt) => rt.id === id) ?? null, [runtimes]);
  const selectedRun = runs.find((r) => r.id === selectedId) ?? null;

  async function handleDecide(id: string, decision: "allow" | "deny") {
    const gate = gates.find((g) => g.id === id) ?? null;
    setGates((prev) => prev.filter((g) => g.id !== id));
    setBusyGate(id);
    const res = await gateDecide(id, decision, decision === "deny" ? "Denied from the Runs UI" : "");
    setBusyGate(null);
    // The server answers HTTP 200 with an inner {ok:false, reason} for a gate
    // that is no longer pending (already decided, or auto-denied by timeout)
    // — the outer envelope alone can't tell success from a stale id.
    if (!res.ok || !res.result || !res.result.ok) {
      const reason = !res.ok ? res.error : res.result && !res.result.ok ? res.result.reason : undefined;
      setActionError(reason ?? `Failed to ${decision} the gate`);
      if (gate) setGates((prev) => [gate, ...prev]);
    }
  }

  async function handleSend(id: string, text: string) {
    setBusyAction("send");
    const res = await runSend(id, text);
    setBusyAction(null);
    if (!res.ok || !res.result?.sent) setActionError(res.error ?? "Failed to send the message — the run may have already ended");
    else scheduleRefresh();
  }

  async function handleInterrupt(id: string) {
    setBusyAction("interrupt");
    const res = await runInterrupt(id);
    setBusyAction(null);
    if (!res.ok || !res.result?.interrupted) setActionError(res.error ?? "Failed to interrupt — the run may have already ended");
    else scheduleRefresh();
  }

  async function handleEnd(id: string) {
    setBusyAction("end");
    const res = await runEnd(id);
    setBusyAction(null);
    if (!res.ok || !res.result?.ended) setActionError(res.error ?? "Failed to end — the run may have already ended");
    else scheduleRefresh();
  }

  if (connStatus === "checking") {
    return (
      <div className="surface-pad runs-page">
        <p className="mono runs-checking">Checking the run engine…</p>
      </div>
    );
  }

  if (connStatus === "down") {
    return (
      <div className="surface-pad runs-page">
        <div className="runs-down panel-card">
          <span className="eyebrow">Run engine unreachable</span>
          <h2>The core server is not running</h2>
          <p className="prose">abcd's run engine lives outside the browser, in a small local server. Start it with:</p>
          <pre className="mono runs-down-cmd">npm run core</pre>
          <p className="prose">This surface picks it up automatically once it is up — nothing to reload.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="surface-pad runs-page">
      {gates.length > 0 && <GatesBanner gates={gates} now={now} busyId={busyGate} onDecide={handleDecide} />}

      {actionError && (
        <p className="mono runs-action-error" role="alert">
          {actionError}
          <button type="button" className="btn btn-ghost" onClick={() => setActionError(null)}>Dismiss</button>
        </p>
      )}

      <div className="runs-layout">
        <aside className="runs-col">
          <div className="runs-col-head">
            <span className="eyebrow">Runs · {active.length} active</span>
            <NewRunForm
              defaultCwd={app.groups[0]?.primaryRoot ?? ""}
              defaultModel={app.settings.model}
              onCreated={(run) => {
                setRuns((prev) => [run, ...prev]);
                setSelectedId(run.id);
              }}
            />
          </div>

          {runs.length === 0 && <div className="empty panel-card">No runs yet. Start one above.</div>}

          {active.length > 0 && (
            <div className="runs-group">
              <span className="eyebrow runs-group-label">Active</span>
              {active.map((r) => (
                <RunCard key={r.id} run={r} runtime={runtimeById(r.runtimeId)} selected={r.id === selectedId} onSelect={() => setSelectedId(r.id)} />
              ))}
            </div>
          )}

          {finished.length > 0 && (
            <div className="runs-group">
              <span className="eyebrow runs-group-label">Finished</span>
              {finished.map((r) => (
                <RunCard key={r.id} run={r} runtime={runtimeById(r.runtimeId)} selected={r.id === selectedId} onSelect={() => setSelectedId(r.id)} />
              ))}
            </div>
          )}
        </aside>

        <section className="runs-detail">
          {selectedRun ? (
            <>
              <RunDetailHead run={selectedRun} runtime={runtimeById(selectedRun.runtimeId)} />
              <RunControls
                run={selectedRun}
                runtime={runtimeById(selectedRun.runtimeId)}
                busyAction={busyAction}
                onSend={(text) => handleSend(selectedRun.id, text)}
                onInterrupt={() => handleInterrupt(selectedRun.id)}
                onEnd={() => handleEnd(selectedRun.id)}
              />
              <OutputPane run={selectedRun} blocks={blocks} />
            </>
          ) : (
            <div className="empty panel-card">No run selected.</div>
          )}
        </section>
      </div>
    </div>
  );
}

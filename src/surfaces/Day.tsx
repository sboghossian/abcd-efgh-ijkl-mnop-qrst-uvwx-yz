import "./Day.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { relTime, compactNum, usd, shortPath } from "../lib/format";
import {
  fetchDay, fetchTargets, dayOpen, dayObjective, dayClose,
  broadcastSend, broadcastWindDown, broadcastResume,
} from "../lib/day";
import type { Day as DayRecord, DayFacts, ReachTarget, TargetTier, BroadcastResult } from "../lib/day";

/**
 * Day — the day loop (core/day.mjs) and broadcast reach (core/broadcast.mjs).
 *
 * Two things this surface refuses to fudge:
 *   - Cost from the index is an ESTIMATE (a public price table), never the
 *     measured figure Runs.tsx shows for abcd's own runs. Always "est.".
 *   - Reach is not uniform. abcd does not write into sessions it did not
 *     start, and even a delivered message is only ever "written to stdin" —
 *     the receiving session's own crossSessionInbound setting still governs
 *     whether it is accepted, held, or refused. Nothing here claims more
 *     than that.
 */

const POLL_MS = 4000;
const DEBOUNCE_MS = 350;

const TIER_HINT: Record<TargetTier, string> = {
  1: "a run abcd started — writable",
  2: "reachable, writable only when tier2Write is on",
  3: "history only — never reachable",
};

type ConnStatus = "checking" | "up" | "down";
type DayBusy = "open" | "save" | "close" | null;
type BroadcastBusy = "send" | "windDown" | "resume" | null;

/* ---------------- day head: objective + open/close ---------------- */

function ObjectiveOpenForm({
  onOpen,
  busy,
  label = "Open day",
}: {
  onOpen: (objective: string) => void;
  busy: boolean;
  label?: string;
}) {
  const [text, setText] = useState("");
  return (
    <form
      className="day-open-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        onOpen(text.trim());
        setText("");
      }}
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What is today's objective?"
      />
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Opening…" : label}
      </button>
    </form>
  );
}

function ObjectiveEditable({
  objective,
  onSave,
  busy,
}: {
  objective: string;
  onSave: (text: string) => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(objective);
  const [dirty, setDirty] = useState(false);
  // Only resync from the server while the human hasn't started typing —
  // otherwise a poll tick would stomp an in-progress edit.
  useEffect(() => {
    if (!dirty) setDraft(objective);
  }, [objective, dirty]);

  return (
    <form
      className="day-objective-edit"
      onSubmit={(e) => {
        e.preventDefault();
        if (!dirty || busy) return;
        onSave(draft.trim());
        setDirty(false);
      }}
    >
      <input
        className="day-objective-input"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setDirty(true);
        }}
        placeholder="What is today's objective?"
      />
      {dirty && (
        <div className="day-objective-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setDraft(objective);
              setDirty(false);
            }}
          >
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </form>
  );
}

/* ---------------- facts / reconciliation ---------------- */

function FactsPanel({ facts }: { facts: DayFacts }) {
  const maxGroup = facts.groups.reduce((m, g) => Math.max(m, g.sessions), 0) || 1;
  return (
    <div className="day-facts">
      <div className="day-facts-stats mono">
        <div className="day-stat">
          <span className="day-stat-n">{facts.sessions}</span>
          <span className="eyebrow">sessions</span>
        </div>
        <div className="day-stat">
          <span className="day-stat-n">{compactNum(facts.tokens)}</span>
          <span className="eyebrow">tokens</span>
        </div>
        <div className="day-stat">
          <span className="day-stat-n">
            {usd(facts.costEstimateUsd)}
            <span className="day-est">est.</span>
          </span>
          <span className="eyebrow">cost</span>
        </div>
        <div className="day-stat">
          <span className="day-stat-n">{facts.filesTouched}</span>
          <span className="eyebrow">files touched</span>
        </div>
      </div>

      {facts.groups.length > 0 && (
        <div className="day-groups">
          <span className="eyebrow">By group</span>
          {facts.groups.map((g) => (
            <div key={g.name} className="day-group-row">
              <span className="day-group-name">{g.name}</span>
              <div className="day-group-bar-track">
                <div className="day-group-bar" style={{ width: `${(g.sessions / maxGroup) * 100}%` }} />
              </div>
              <span className="mono day-group-n">{g.sessions}</span>
            </div>
          ))}
        </div>
      )}

      {facts.titles.length > 0 && (
        <div className="day-titles">
          <span className="eyebrow">What happened</span>
          <ul className="day-titles-list">
            {facts.titles.slice(0, 8).map((t, i) => (
              <li key={i} className="day-title-row prose">{t}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ReconciliationPanel({ day }: { day: DayRecord }) {
  const rec = day.reconciliation;
  if (!rec) return null;
  return (
    <div className="day-reconciliation">
      <div className="day-reconciliation-head">
        <span className="eyebrow">{day.closedAt ? `Closed ${relTime(day.closedAt)} ago` : "Closed"}</span>
      </div>
      {rec.note && <p className="day-reconciliation-note prose">{rec.note}</p>}
      <FactsPanel facts={rec} />
    </div>
  );
}

/* ---------------- day head ---------------- */

function DayHead({
  day, facts, dayBusy, dayError, onOpen, onSaveObjective, onClose,
  closing, onToggleClosing, closeNote, onCloseNoteChange,
}: {
  day: DayRecord;
  facts: DayFacts | null;
  dayBusy: DayBusy;
  dayError: string | null;
  onOpen: (objective: string) => void;
  onSaveObjective: (text: string) => void;
  onClose: (note: string) => void;
  closing: boolean;
  onToggleClosing: (v: boolean) => void;
  closeNote: string;
  onCloseNoteChange: (v: string) => void;
}) {
  const isClosed = Boolean(day.closedAt);
  const isOpen = Boolean(day.openedAt) && !isClosed;
  const notStarted = !day.openedAt;

  return (
    <section className="day-head panel-card">
      <div className="day-head-top">
        <span className="eyebrow">{day.date}</span>
        {isOpen && <span className="chip day-chip-open">open</span>}
        {isClosed && <span className="chip day-chip-closed">closed</span>}
        {notStarted && <span className="chip day-chip-none">not started</span>}
      </div>

      {notStarted && <ObjectiveOpenForm onOpen={onOpen} busy={dayBusy === "open"} />}

      {isOpen && (
        <>
          <ObjectiveEditable objective={day.objective} onSave={onSaveObjective} busy={dayBusy === "save"} />
          <div className="day-close-row">
            {!closing ? (
              <button type="button" className="btn" onClick={() => onToggleClosing(true)}>
                Close day
              </button>
            ) : (
              <form
                className="day-close-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  onClose(closeNote.trim());
                }}
              >
                <input
                  className="day-close-note"
                  value={closeNote}
                  onChange={(e) => onCloseNoteChange(e.target.value)}
                  placeholder="Closing note (optional)"
                />
                <button type="button" className="btn btn-ghost" onClick={() => onToggleClosing(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={dayBusy === "close"}>
                  {dayBusy === "close" ? "Closing…" : "Confirm close"}
                </button>
              </form>
            )}
          </div>
        </>
      )}

      {isClosed && (
        <>
          <p className="day-objective-static prose">{day.objective || "(no objective set)"}</p>
          <ObjectiveOpenForm onOpen={onOpen} busy={dayBusy === "open"} label="Start new day" />
        </>
      )}

      {dayError && <p className="mono day-error" role="alert">{dayError}</p>}

      {isOpen && facts && <FactsPanel facts={facts} />}
      {isClosed && <ReconciliationPanel day={day} />}
    </section>
  );
}

/* ---------------- recent days strip ---------------- */

function RecentStrip({ days }: { days: DayRecord[] }) {
  if (days.length === 0) return null;
  return (
    <section className="day-recent">
      <span className="eyebrow">Recent days</span>
      <div className="day-recent-list scroll">
        {days.map((d) => {
          const closed = Boolean(d.closedAt);
          const open = Boolean(d.openedAt) && !closed;
          const sessions = d.reconciliation?.sessions ?? null;
          return (
            <div key={d.date} className="day-recent-card" title={d.objective || "(no objective set)"}>
              <div className="day-recent-top">
                <span className="mono day-recent-date">{d.date}</span>
                <span className={`dot ${closed ? "day-dot-closed" : open ? "day-dot-open" : "day-dot-none"}`} />
              </div>
              <p className="day-recent-objective">{d.objective || "—"}</p>
              {sessions !== null && <span className="mono day-recent-n">{sessions} session{sessions === 1 ? "" : "s"}</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------- reach: grouped targets, checkbox = broadcast selection ---------------- */

function TargetRow({
  target, checked, onToggle,
}: {
  target: ReachTarget;
  checked: boolean;
  onToggle: (id: string) => void;
}) {
  const path = target.cwd ?? target.label;
  return (
    <label className={`target-row${target.writable ? " tr-writable" : " tr-blocked"}`}>
      <input type="checkbox" checked={checked} onChange={() => onToggle(target.id)} />
      <span className={`dot ${target.writable ? "tr-dot-writable" : "tr-dot-blocked"}`} />
      <span className="chip target-kind">{target.kind}</span>
      <span className="mono target-label" title={path}>{shortPath(path)}</span>
      {target.sessionId && <span className="mono target-session">{target.sessionId.slice(0, 8)}</span>}
      {target.entrypoint && <span className="mono target-entrypoint">{target.entrypoint}</span>}
      <span className="target-reason">{target.reason}</span>
      <span className={`mono target-flag${target.writable ? " tr-writable" : " tr-blocked"}`}>
        {target.writable ? "writable" : "not writable"}
      </span>
    </label>
  );
}

function ReachSection({
  targets, tier2Write, selected, onToggle,
}: {
  targets: ReachTarget[];
  tier2Write: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const byTier = useMemo(() => {
    const m = new Map<TargetTier, ReachTarget[]>([[1, []], [2, []], [3, []]]);
    for (const t of targets) m.get(t.tier)?.push(t);
    return m;
  }, [targets]);

  return (
    <section className="reach panel-card">
      <div className="reach-head">
        <span className="eyebrow">Reach · {targets.length} target{targets.length === 1 ? "" : "s"}</span>
        <span className={`mono reach-tier2write${tier2Write ? " on" : ""}`}>
          tier2Write {tier2Write ? "on" : "off"}
        </span>
      </div>
      <p className="reach-note prose">
        abcd does not write into sessions it did not start. Even a message it can deliver only ever reaches a
        target's stdin — the receiving session's own <span className="mono">crossSessionInbound</span> setting
        still decides whether that message is accepted, held, or refused.
      </p>

      {([1, 2, 3] as TargetTier[]).map((tier) => {
        const rows = byTier.get(tier) ?? [];
        return (
          <div key={tier} className="reach-tier">
            <div className="reach-tier-head">
              <span className="chip">tier {tier}</span>
              <span className="reach-tier-hint">{TIER_HINT[tier]}</span>
              <span className="mono reach-tier-count">{rows.length}</span>
            </div>
            {rows.length === 0 ? (
              <p className="reach-tier-empty mono">none right now</p>
            ) : (
              <div className="reach-tier-list">
                {rows.map((t) => (
                  <TargetRow key={t.id} target={t} checked={selected.has(t.id)} onToggle={onToggle} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

/* ---------------- broadcast result — the important panel ---------------- */

function BroadcastResultPanel({ result, onDismiss }: { result: BroadcastResult; onDismiss: () => void }) {
  return (
    <div className="broadcast-result" role="status">
      <div className="broadcast-result-head">
        <span className="eyebrow">Result</span>
        <span className="mono broadcast-result-counts">
          <span className="br-count br-delivered">{result.delivered} delivered</span>
          <span className="br-count br-unreachable">{result.unreachable} not delivered</span>
        </span>
        <button type="button" className="btn btn-ghost" onClick={onDismiss}>Dismiss</button>
      </div>
      <p className="broadcast-result-note prose">
        "Delivered" means abcd wrote this to the target's stdin — not that the receiving session read it, acted on
        it, or even accepted it. Its own crossSessionInbound setting still governs what happens next.
      </p>
      <div className="broadcast-result-list">
        {result.results.map((r) => (
          <div key={r.id} className={`br-row br-${r.outcome}`}>
            <span className={`dot br-dot-${r.outcome}`} />
            <span className="chip">{r.outcome}</span>
            <span className="mono br-label" title={r.cwd ?? r.label}>{shortPath(r.cwd ?? r.label)}</span>
            <span className="br-reason">{r.error ?? r.reason}</span>
          </div>
        ))}
        {result.results.length === 0 && <p className="reach-tier-empty mono">No targets were selected.</p>}
      </div>
    </div>
  );
}

/* ---------------- broadcast compose ---------------- */

function BroadcastPanel({
  targets, selected, busy, actionError, result,
  onSend, onWindDown, onResume, onDismissResult,
}: {
  targets: ReachTarget[];
  selected: Set<string>;
  busy: BroadcastBusy;
  actionError: string | null;
  result: BroadcastResult | null;
  onSend: (text: string) => void;
  onWindDown: (text: string | undefined) => void;
  onResume: (text: string | undefined) => void;
  onDismissResult: () => void;
}) {
  const [text, setText] = useState("");
  const writableCount = targets.filter((t) => t.writable).length;
  const canSend = selected.size > 0 && text.trim().length > 0 && busy === null;

  return (
    <section className="broadcast panel-card">
      <div className="broadcast-head">
        <span className="eyebrow">Broadcast</span>
        <span className="mono broadcast-target-count">
          {selected.size} of {targets.length} selected · {writableCount} writable
        </span>
      </div>

      <textarea
        className="broadcast-text"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Message to send…"
      />
      <p className="broadcast-note">
        All three go only to the targets checked above, or to every writable target when nothing is checked.
        Wind down and Resume use the message above only if you typed one, otherwise abcd's
        own default text for that action.
      </p>

      <div className="broadcast-actions">
        <button type="button" className="btn btn-primary" disabled={!canSend} onClick={() => onSend(text.trim())}>
          {busy === "send" ? "Sending…" : "Send"}
        </button>
        <button type="button" className="btn" disabled={busy !== null} onClick={() => onWindDown(text.trim() || undefined)}>
          {busy === "windDown" ? "Sending…" : "Wind down"}
        </button>
        <button type="button" className="btn" disabled={busy !== null} onClick={() => onResume(text.trim() || undefined)}>
          {busy === "resume" ? "Sending…" : "Resume"}
        </button>
      </div>

      {actionError && <p className="mono broadcast-error" role="alert">{actionError}</p>}
      {result && <BroadcastResultPanel result={result} onDismiss={onDismissResult} />}
    </section>
  );
}

/* ---------------- surface ---------------- */

export function Day() {
  const mountedRef = useRef(true);
  // Re-armed on every mount, not only initialised once — see Runs.tsx's own
  // note on this: StrictMode mounts, cleans up, then mounts again, and a
  // `false` left over from a stale initial value would strand every later
  // fetch behind a mountedRef that never comes back.
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [connStatus, setConnStatus] = useState<ConnStatus>("checking");
  const [day, setDay] = useState<DayRecord | null>(null);
  const [facts, setFacts] = useState<DayFacts | null>(null);
  const [recent, setRecent] = useState<DayRecord[]>([]);
  const [targets, setTargets] = useState<ReachTarget[]>([]);
  const [tier2Write, setTier2Write] = useState(false);

  const [dayBusy, setDayBusy] = useState<DayBusy>(null);
  const [dayError, setDayError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeNote, setCloseNote] = useState("");

  const [customSelection, setCustomSelection] = useState<Set<string> | null>(null);
  const [broadcastBusy, setBroadcastBusy] = useState<BroadcastBusy>(null);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);
  const [broadcastResult, setBroadcastResult] = useState<BroadcastResult | null>(null);

  const refreshAll = useCallback(async () => {
    const [d, t] = await Promise.all([fetchDay(), fetchTargets()]);
    if (!mountedRef.current) return;
    if (d) {
      setDay(d.day);
      setFacts(d.facts);
      setRecent(d.recent);
      setConnStatus("up");
    } else {
      setConnStatus("down");
    }
    if (t) {
      setTargets(t.targets);
      setTier2Write(t.tier2Write);
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    const tick = () => { if (!stopped) refreshAll(); };
    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => { stopped = true; window.clearInterval(id); };
  }, [refreshAll]);

  const refreshTimer = useRef<number | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(refreshAll, DEBOUNCE_MS);
  }, [refreshAll]);
  useEffect(() => () => {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
  }, []);

  const selected = useMemo(() => {
    if (customSelection) return customSelection;
    return new Set(targets.filter((t) => t.writable).map((t) => t.id));
  }, [customSelection, targets]);

  const toggleTarget = useCallback((id: string) => {
    setCustomSelection((prev) => {
      const base = prev ?? new Set(targets.filter((t) => t.writable).map((t) => t.id));
      const next = new Set(base);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, [targets]);

  async function handleOpen(objective: string) {
    setDayBusy("open");
    setDayError(null);
    const res = await dayOpen(objective);
    if (!mountedRef.current) return;
    setDayBusy(null);
    if (!res.ok || !res.result) { setDayError(res.error ?? "Failed to open the day"); return; }
    setDay(res.result);
    scheduleRefresh();
  }

  async function handleSaveObjective(objective: string) {
    setDayBusy("save");
    setDayError(null);
    const res = await dayObjective(objective);
    if (!mountedRef.current) return;
    setDayBusy(null);
    if (!res.ok || !res.result) { setDayError(res.error ?? "Failed to save the objective"); return; }
    setDay(res.result);
  }

  async function handleClose(note: string) {
    setDayBusy("close");
    setDayError(null);
    const res = await dayClose(note);
    if (!mountedRef.current) return;
    setDayBusy(null);
    if (!res.ok || !res.result) { setDayError(res.error ?? "Failed to close the day"); return; }
    setDay(res.result);
    setClosing(false);
    setCloseNote("");
    scheduleRefresh();
  }

  async function handleSend(text: string) {
    setBroadcastBusy("send");
    setBroadcastError(null);
    const res = await broadcastSend(text, Array.from(selected));
    if (!mountedRef.current) return;
    setBroadcastBusy(null);
    if (!res.ok || !res.result) { setBroadcastError(res.error ?? "Broadcast failed"); return; }
    setBroadcastResult(res.result);
  }

  async function handleWindDown(text: string | undefined) {
    setBroadcastBusy("windDown");
    setBroadcastError(null);
    const res = await broadcastWindDown(text);
    if (!mountedRef.current) return;
    setBroadcastBusy(null);
    if (!res.ok || !res.result) { setBroadcastError(res.error ?? "Wind down failed"); return; }
    setBroadcastResult(res.result);
  }

  async function handleResume(text: string | undefined) {
    setBroadcastBusy("resume");
    setBroadcastError(null);
    const res = await broadcastResume(text);
    if (!mountedRef.current) return;
    setBroadcastBusy(null);
    if (!res.ok || !res.result) { setBroadcastError(res.error ?? "Resume failed"); return; }
    setBroadcastResult(res.result);
  }

  if (connStatus === "checking") {
    return (
      <div className="surface-pad day-page">
        <p className="mono day-checking">Checking the day loop…</p>
      </div>
    );
  }

  if (connStatus === "down" || !day) {
    return (
      <div className="surface-pad day-page">
        <div className="day-down panel-card">
          <span className="eyebrow">Day loop unreachable</span>
          <h2>The core server is not running</h2>
          <p className="prose">The day loop and broadcast reach live outside the browser, in a small local server. Start it with:</p>
          <pre className="mono day-down-cmd">npm run core</pre>
          <p className="prose">This surface picks it up automatically once it is up — nothing to reload.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="surface-pad day-page">
      <DayHead
        day={day}
        facts={facts}
        dayBusy={dayBusy}
        dayError={dayError}
        onOpen={handleOpen}
        onSaveObjective={handleSaveObjective}
        onClose={handleClose}
        closing={closing}
        onToggleClosing={setClosing}
        closeNote={closeNote}
        onCloseNoteChange={setCloseNote}
      />

      <RecentStrip days={recent} />

      <ReachSection targets={targets} tier2Write={tier2Write} selected={selected} onToggle={toggleTarget} />

      <BroadcastPanel
        targets={targets}
        selected={selected}
        busy={broadcastBusy}
        actionError={broadcastError}
        result={broadcastResult}
        onSend={handleSend}
        onWindDown={handleWindDown}
        onResume={handleResume}
        onDismissResult={() => setBroadcastResult(null)}
      />
    </div>
  );
}

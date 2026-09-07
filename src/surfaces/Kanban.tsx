import "./Kanban.css";
import { useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useStore } from "../lib/store";
import type { Group, Session, SessionStatus } from "../lib/types";
import { relTime, compactNum, usd, totalTokens, shortModel, STATUS_LABEL } from "../lib/format";
import { GroupGlyph } from "../lib/glyph";
import { IconGhost, IconClose } from "../shell/icons";

const COLUMN_ORDER: SessionStatus[] = ["needs-input", "working", "idle", "completed", "failed"];

const EMPTY_COPY: Record<SessionStatus, string> = {
  "needs-input": "Nothing needs you right now.",
  working: "Nothing running.",
  idle: "Nothing idle.",
  completed: "Nothing completed yet.",
  failed: "Nothing failed. Good.",
};

interface DropNote {
  status: SessionStatus;
  title: string;
}

export function Kanban() {
  const { app, dispatch } = useStore();
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [onlyNeedsMe, setOnlyNeedsMe] = useState(false);
  const [dragOverStatus, setDragOverStatus] = useState<SessionStatus | null>(null);
  const [note, setNote] = useState<DropNote | null>(null);
  const noteTimeout = useRef<number | null>(null);

  const groupById = useMemo(() => new Map(app.groups.map((g) => [g.id, g])), [app.groups]);
  const sortedGroups = useMemo(() => [...app.groups].sort((a, b) => a.order - b.order), [app.groups]);

  const filtered = useMemo(() => {
    return app.sessions.filter((s) => {
      if (selectedGroups.size > 0 && !selectedGroups.has(s.groupId)) return false;
      if (onlyNeedsMe && s.status !== "needs-input") return false;
      return true;
    });
  }, [app.sessions, selectedGroups, onlyNeedsMe]);

  const columns = useMemo(() => {
    const map = new Map<SessionStatus, Session[]>();
    for (const status of COLUMN_ORDER) map.set(status, []);
    for (const s of filtered) {
      map.get(s.status)?.push(s);
    }
    for (const list of map.values()) list.sort((a, b) => +new Date(b.lastActivityAt) - +new Date(a.lastActivityAt));
    return map;
  }, [filtered]);

  function toggleGroup(id: string) {
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function activateSession(s: Session) {
    dispatch({ type: "group", id: s.groupId });
    dispatch({ type: "activate", columnId: s.columnId, sessionId: s.id });
  }

  function armNote(status: SessionStatus, title: string) {
    if (noteTimeout.current !== null) window.clearTimeout(noteTimeout.current);
    setNote({ status, title });
    noteTimeout.current = window.setTimeout(() => setNote(null), 4200);
  }

  function dismissNote() {
    if (noteTimeout.current !== null) window.clearTimeout(noteTimeout.current);
    setNote(null);
  }

  function handleDrop(status: SessionStatus, e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOverStatus(null);
    const sid = e.dataTransfer.getData("text/plain");
    const s = app.sessions.find((x) => x.id === sid);
    if (!s) return;
    armNote(status, s.title);
  }

  return (
    <div className="surface-pad kb-page">
      <p className="kb-intro prose">
        Every session across every group, one board. Sorted by what is blocked on you first.
      </p>

      <div className="kb-filters">
        <div className="kb-filter-groups">
          <span className="eyebrow">Group</span>
          {sortedGroups.map((g: Group) => {
            const on = selectedGroups.has(g.id);
            return (
              <button
                key={g.id}
                type="button"
                className={`kb-chip mono${on ? " on" : ""}`}
                aria-pressed={on}
                onClick={() => toggleGroup(g.id)}
              >
                <GroupGlyph seed={g.glyphSeed} size={12} />
                {g.name}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className={`kb-toggle mono${onlyNeedsMe ? " on" : ""}`}
          aria-pressed={onlyNeedsMe}
          onClick={() => setOnlyNeedsMe((v) => !v)}
        >
          Only what needs me
        </button>
      </div>

      <div className="kb-board scroll">
        {COLUMN_ORDER.map((status) => {
          const sessions = columns.get(status) ?? [];
          const isDragOver = dragOverStatus === status;
          return (
            <div
              key={status}
              className={`kb-col${isDragOver ? " drag-over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragOverStatus !== status) setDragOverStatus(status);
              }}
              onDragLeave={() => setDragOverStatus((cur) => (cur === status ? null : cur))}
              onDrop={(e) => handleDrop(status, e)}
            >
              <div className="kb-col-head">
                <span className={`dot s-${status}`} />
                <span className="kb-col-title">{STATUS_LABEL[status]}</span>
                <span className="kb-col-count mono">{sessions.length}</span>
              </div>

              {note && note.status === status && (
                <div className="kb-note" role="status" aria-live="polite">
                  <p>
                    <strong className="mono">{note.title}</strong> stays here — status is derived from the
                    session itself, not set by hand.
                  </p>
                  <button type="button" className="kb-note-close" aria-label="Dismiss note" onClick={dismissNote}>
                    <IconClose />
                  </button>
                </div>
              )}

              <div className="kb-col-body scroll">
                {sessions.length === 0 && <p className="kb-empty">{EMPTY_COPY[status]}</p>}
                {sessions.map((s) => {
                  const group = groupById.get(s.groupId);
                  return (
                    <SessionCard
                      key={s.id}
                      session={s}
                      group={group}
                      onActivate={() => activateSession(s)}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SessionCard({
  session,
  group,
  onActivate,
}: {
  session: Session;
  group: Group | undefined;
  onActivate: () => void;
}) {
  function onKeyDown(e: ReactKeyboardEvent<HTMLElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onActivate();
    }
  }

  return (
    <article
      className="kb-card"
      draggable
      onDragStart={(e: DragEvent<HTMLElement>) => {
        e.dataTransfer.setData("text/plain", session.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${session.title}`}
      onClick={onActivate}
      onKeyDown={onKeyDown}
    >
      <p className="kb-card-title">{session.title}</p>

      <div className="kb-card-group">
        {group ? (
          <>
            <GroupGlyph seed={group.glyphSeed} size={14} />
            <span>{group.name}</span>
          </>
        ) : (
          <span className="kb-card-nogroup">Unknown group</span>
        )}
      </div>

      <div className="kb-card-meta mono">
        <span className="chip">{session.runtime}</span>
        <span>{shortModel(session.model)}</span>
        <span>{relTime(session.lastActivityAt)}</span>
      </div>

      <div className="kb-card-stats mono">
        <span>{compactNum(totalTokens(session.tokens))} tok</span>
        <span>{usd(session.costEstimateUsd)} est.</span>
      </div>

      {(session.incognito || session.remoteControlled || session.tier === 3 || session.outsideRoot) && (
        <div className="kb-card-badges">
          {session.incognito && (
            <span className="chip kb-badge s-incognito">
              <IconGhost /> incognito
            </span>
          )}
          {session.remoteControlled && <span className="chip kb-badge kb-badge-neutral">remote</span>}
          {session.tier === 3 && <span className="chip kb-badge kb-badge-neutral">read-only</span>}
          {session.outsideRoot && <span className="chip kb-badge kb-badge-neutral">outside root</span>}
        </div>
      )}
    </article>
  );
}

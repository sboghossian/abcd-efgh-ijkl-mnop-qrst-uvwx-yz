import { useState } from "react";
import "./Groups.css";
import { useStore, useColumns } from "../lib/store";
import type { Session } from "../lib/types";
import { GroupGlyph } from "../lib/glyph";
import { relTime, clock, compactNum, usd, totalTokens, shortModel, shortPath, STATUS_LABEL } from "../lib/format";
import { IconPlus, IconClose, IconGhost, IconExpand } from "../shell/icons";

/* ---------------- group strip ---------------- */

function GroupStrip() {
  const { app, ui, dispatch } = useStore();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  return (
    <nav className="gstrip" aria-label="Groups">
      {app.groups.map((g) => {
        const count = app.sessions.filter((s) => s.groupId === g.id).length;
        const blocked = app.sessions.filter((s) => s.groupId === g.id && s.status === "needs-input").length;
        const on = ui.activeGroupId === g.id;
        return (
          <button key={g.id} className={`gtab${on ? " on" : ""}`} onClick={() => dispatch({ type: "group", id: g.id })}
            title={`${g.name} — ${g.primaryRoot}`} aria-current={on ? "true" : undefined}>
            <GroupGlyph seed={g.glyphSeed} size={18} />
            <span className="gtab-name">{g.name}</span>
            <span className="mono gtab-count">{count}</span>
            {blocked > 0 && <span className="gtab-blocked" title={`${blocked} need input`} />}
          </button>
        );
      })}
      {adding ? (
        <div className="gtab gtab-add">
          <input autoFocus value={name} placeholder="Group name" onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) { dispatch({ type: "addGroup", name: name.trim(), root: "~/Code" }); setName(""); setAdding(false); }
              if (e.key === "Escape") { setName(""); setAdding(false); }
            }}
            onBlur={() => { setName(""); setAdding(false); }} />
        </div>
      ) : (
        <button className="gtab gtab-new" onClick={() => setAdding(true)} title="New group" aria-label="New group"><IconPlus /></button>
      )}
    </nav>
  );
}

/* ---------------- session tab ---------------- */

function SessionTab({ s, columnId, active }: { s: Session; columnId: string; active: boolean }) {
  const { dispatch } = useStore();
  return (
    <div
      className={`stab${active ? " on" : ""}`}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData("text/session", s.id); e.dataTransfer.effectAllowed = "move"; }}
      onClick={() => dispatch({ type: "activate", columnId, sessionId: s.id })}
      role="tab"
      aria-selected={active}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); dispatch({ type: "activate", columnId, sessionId: s.id }); } }}
      title={`${s.title} — ${shortPath(s.cwd)}`}
    >
      <span className={`dot s-${s.status}`} />
      {s.incognito && <span className="stab-ghost" title="Incognito"><IconGhost /></span>}
      <span className="stab-title">{s.title}</span>
      <span className="mono stab-id">{s.shortId}</span>
      <button className="stab-x" aria-label={`Close ${s.title}`} title="Close session"
        onClick={(e) => { e.stopPropagation(); dispatch({ type: "closeSession", sessionId: s.id }); }}>
        <IconClose />
      </button>
    </div>
  );
}

/* ---------------- session body ---------------- */

type BodyTab = "chat" | "work" | "files";

function SessionMeta({ s }: { s: Session }) {
  const { app } = useStore();
  return (
    <div className="smeta mono">
      <span className={`chip s-${s.status}`}>{STATUS_LABEL[s.status]}</span>
      <span className="smeta-i">{shortModel(s.model)}</span>
      <span className={`smeta-runtime rt-${s.runtime}`}>{s.runtime}</span>
      {s.remoteControlled && <span className="smeta-i" title={`Started in ${s.entrypoint}`}>remote</span>}
      {s.tier === 3 && <span className="smeta-i warn" title="abcd can observe this session but not write to it">tier 3 · read-only</span>}
      {s.outsideRoot && <span className="smeta-i warn" title="cwd falls outside every root of this group">outside root</span>}
      <span className="smeta-sep" />
      <span className="smeta-i" title={s.cwd}>{shortPath(s.cwd)}</span>
      {s.gitBranch && <span className="smeta-i">{s.gitBranch}</span>}
      {s.linearRefs.map((r) => <span key={r} className="smeta-i">{r}</span>)}
      <span className="smeta-sep" />
      <span className="smeta-i" title="input + output + cache">{compactNum(totalTokens(s.tokens))} tok</span>
      {app.settings.showEstimatedCost && (
        <span className="smeta-i" title="Estimated from a public price table. A subscription has no per-token bill.">
          {usd(s.costEstimateUsd)} est.
        </span>
      )}
      <span className="smeta-i">{relTime(s.lastActivityAt)}</span>
    </div>
  );
}

function Transcript({ s }: { s: Session }) {
  const { app } = useStore();
  const turns = app.turns.filter((t) => t.sessionId === s.id);
  if (turns.length === 0) {
    return <div className="empty">Nothing in this session yet. Select it in the prompt box below to send it something.</div>;
  }
  return (
    <div className="transcript">
      {turns.map((t) => (
        <article key={t.id} className={`turn turn-${t.role}`}>
          <header className="turn-h mono">
            <span className="turn-role">{t.role === "user" ? "You" : shortModel(s.model)}</span>
            <span className="turn-at">{clock(t.at)}</span>
          </header>
          <p className={t.role === "assistant" ? "turn-body prose" : "turn-body"}>{t.text}</p>
          {t.thinking && <p className="turn-think">{t.thinking}</p>}
          {t.toolCalls && t.toolCalls.length > 0 && (
            <ul className="tools">
              {t.toolCalls.map((c) => (
                <li key={c.id} className={`tool tool-${c.status}`}>
                  <span className="mono tool-name">{c.name}</span>
                  <span className="mono tool-sum">{c.summary}</span>
                  <span className="mono tool-st">
                    {c.status === "running" ? "running" : c.durationMs != null ? `${c.durationMs}ms` : c.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </div>
  );
}

function WorkList({ s }: { s: Session }) {
  const { app, dispatch } = useStore();
  const tasks = app.tasks.filter((t) => t.sessionId === s.id);
  if (tasks.length === 0) return <div className="empty">No task list on this session yet.</div>;
  return (
    <ul className="worklist">
      {tasks.map((t) => {
        const blockers = t.blockedBy.map((b) => app.tasks.find((x) => x.id === b)).filter(Boolean);
        return (
          <li key={t.id} className={`work work-${t.status}`}>
            <button className="work-box" aria-label={`Toggle ${t.subject}`} onClick={() => dispatch({ type: "toggleTask", taskId: t.id })}>
              <span className="work-mark">{t.status === "completed" ? "✓" : t.status === "in_progress" ? "·" : ""}</span>
            </button>
            <div className="work-body">
              <span className="work-subject">{t.subject}</span>
              {blockers.length > 0 && (
                <span className="mono work-blocked">after {blockers.map((b) => b!.subject).join(", ")}</span>
              )}
            </div>
            <span className={`mono work-status s-${t.status === "completed" ? "completed" : t.status === "blocked" ? "needs-input" : "working"}`}>
              {t.status.replace("_", " ")}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const KIND_LABEL: Record<string, string> = {
  file: "File", memory: "Memory", artifact: "Artifact", pr: "Pull request", commit: "Commit", attachment: "Attachment",
};

function FilesList({ s }: { s: Session }) {
  const { app } = useStore();
  const outs = app.outputs.filter((o) => o.sessionId === s.id);
  const msgs = app.turns.filter((t) => t.sessionId === s.id && t.role === "user");
  return (
    <div className="fileswrap">
      <div className="files-note">
        Everything this session produced, and everything you asked it. Built for reading, not for the terminal.
      </div>
      <div className="eyebrow files-h">You said · {msgs.length}</div>
      <ul className="saidlist">
        {msgs.map((m) => (
          <li key={m.id}><span className="mono said-at">{clock(m.at)}</span><span className="said-text">{m.text}</span></li>
        ))}
        {msgs.length === 0 && <li className="empty">Nothing sent yet.</li>}
      </ul>
      <div className="eyebrow files-h">Produced · {outs.length}</div>
      <ul className="outlist">
        {outs.map((o) => (
          <li key={o.id} className={`out out-${o.kind}`}>
            <span className="mono out-kind">{KIND_LABEL[o.kind] ?? o.kind}</span>
            <span className="out-label">{o.label}</span>
            <span className="mono out-path" title={o.path}>{shortPath(o.path)}</span>
            {o.detail && <span className="mono out-detail">{o.detail}</span>}
            <span className="mono out-at">{relTime(o.at)}</span>
          </li>
        ))}
        {outs.length === 0 && <li className="empty">Nothing produced yet.</li>}
      </ul>
      <div className="eyebrow files-h">Working directory</div>
      <p className="mono files-cwd">{s.cwd}</p>
    </div>
  );
}

function SessionPanel({ s }: { s: Session }) {
  const [tab, setTab] = useState<BodyTab>("chat");
  return (
    <div className="spanel">
      <SessionMeta s={s} />
      <div className="sbody-tabs" role="tablist" aria-label="Session view">
        {(["chat", "work", "files"] as BodyTab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`sbody-tab${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>
            {t === "chat" ? "Conversation" : t === "work" ? "Task list" : "Files & output"}
          </button>
        ))}
      </div>
      <div className="sbody scroll">
        {tab === "chat" && <Transcript s={s} />}
        {tab === "work" && <WorkList s={s} />}
        {tab === "files" && <FilesList s={s} />}
      </div>
    </div>
  );
}

/* ---------------- column ---------------- */

function Column({ id, sessions }: { id: string; sessions: Session[] }) {
  const { ui, dispatch } = useStore();
  const [over, setOver] = useState(false);
  const activeId = ui.activeByColumn[id] ?? sessions[0]?.id;
  const active = sessions.find((s) => s.id === activeId) ?? sessions[0];

  return (
    <section
      className={`column${over ? " dragover" : ""}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("text/session")) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setOver(false);
        const sid = e.dataTransfer.getData("text/session");
        if (sid) dispatch({ type: "moveSession", sessionId: sid, columnId: id });
      }}
    >
      <div className="stabs" role="tablist" aria-label="Sessions in this column">
        {sessions.map((s) => <SessionTab key={s.id} s={s} columnId={id} active={s.id === active?.id} />)}
      </div>
      {active ? <SessionPanel s={active} /> : <div className="empty">Drop a session here, or start a new one.</div>}
    </section>
  );
}

/* ---------------- surface ---------------- */

export function Groups() {
  const { app, ui, dispatch } = useStore();
  const columns = useColumns(ui.activeGroupId);
  const group = app.groups.find((g) => g.id === ui.activeGroupId);
  const inGroup = app.sessions.filter((s) => s.groupId === ui.activeGroupId);

  if (!group) return <div className="empty">No group selected.</div>;

  return (
    <div className={`groups${ui.focusMode ? " focus" : ""}`}>
      {!ui.focusMode && <GroupStrip />}
      <div className="gmain">
        <div className="ghead">
          <div className="ghead-l">
            <GroupGlyph seed={group.glyphSeed} size={20} />
            <h2>{group.name}</h2>
            <span className="mono ghead-root" title="Primary root — default cwd for new sessions">{shortPath(group.primaryRoot)}</span>
            {group.extraRoots.length > 0 && (
              <span className="mono ghead-extra" title={group.extraRoots.join("\n")}>+{group.extraRoots.length} roots</span>
            )}
          </div>
          <div className="ghead-r mono">
            <span>{inGroup.length} sessions</span>
            <button className="btn" onClick={() => dispatch({ type: "newSessionModal", open: true })}>New session</button>
            <button className="btn" onClick={() => dispatch({ type: "focus", on: !ui.focusMode })}
              title={ui.focusMode ? "Leave focus  esc" : "Focus this group"} aria-label="Toggle focus mode">
              <IconExpand />
            </button>
          </div>
        </div>
        <div className="columns scroll">
          {columns.length === 0
            ? <div className="empty">This group has no sessions yet.</div>
            : columns.map((c) => <Column key={c.id} id={c.id} sessions={c.sessions} />)}
        </div>
      </div>
    </div>
  );
}

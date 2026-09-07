import { useState } from "react";
import { useStore } from "../lib/store";
import type { Runtime } from "../lib/types";

function Shell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <h2 className="modal-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function NewSessionModal() {
  const { app, ui, dispatch } = useStore();
  const [title, setTitle] = useState("");
  const [groupId, setGroupId] = useState(ui.activeGroupId || (app.groups[0]?.id ?? ""));
  const [runtime, setRuntime] = useState<Runtime>("claude");
  const [incognito, setIncognito] = useState(app.settings.incognitoByDefault);
  const group = app.groups.find((g) => g.id === groupId);

  return (
    <Shell title="New session" onClose={() => dispatch({ type: "newSessionModal", open: false })}>
      <label className="field"><span className="eyebrow">What is it for</span>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Cap the webhook retries" />
      </label>
      <label className="field"><span className="eyebrow">Group</span>
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          {app.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </label>
      <p className="field-note mono">{group?.primaryRoot}</p>
      <label className="field"><span className="eyebrow">Runtime</span>
        <select value={runtime} onChange={(e) => setRuntime(e.target.value as Runtime)}>
          <option value="claude">Claude Code — full harness</option>
          <option value="codex">Codex — runs and streams only</option>
        </select>
      </label>
      {runtime === "codex" && <p className="field-note">Codex has no session registry, so it cannot receive broadcasts and the harness surfaces do not apply to it.</p>}
      <label className="check">
        <input type="checkbox" checked={incognito} onChange={(e) => setIncognito(e.target.checked)} />
        <span>Incognito — no transcript, no memory, no vault capture. Gone on close.</span>
      </label>
      <div className="modal-actions">
        <button className="btn" onClick={() => dispatch({ type: "newSessionModal", open: false })}>Cancel</button>
        <button className="btn btn-primary" onClick={() => dispatch({ type: "newSession", groupId, incognito, runtime, title })}>Start session</button>
      </div>
    </Shell>
  );
}

export function WindDownModal() {
  const { app, dispatch } = useStore();
  const reachable = app.sessions.filter((s) => s.tier !== 3);
  const unreachable = app.sessions.filter((s) => s.tier === 3);
  const [msg, setMsg] = useState("I am closing in 10 minutes. Commit what is green, write a resume note, and stop at a safe point.");
  return (
    <Shell title="Wind down the day" onClose={() => dispatch({ type: "windDown", open: false })}>
      <p className="modal-lede">Claude Code has no pause. This sends every reachable session an instruction to checkpoint itself, which is cooperative — a session mid-loop may finish its turn first.</p>
      <label className="field"><span className="eyebrow">Broadcast</span>
        <textarea rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} />
      </label>
      <div className="winddown-counts mono">
        <span><strong>{reachable.length}</strong> will receive this</span>
        {unreachable.length > 0 && <span className="s-idle"><strong>{unreachable.length}</strong> unreachable at tier 3</span>}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={() => dispatch({ type: "windDown", open: false })}>Cancel</button>
        <button className="btn btn-primary" onClick={() => dispatch({ type: "windDownAll" })}>Send and wind down</button>
      </div>
    </Shell>
  );
}

export function DayPromptModal() {
  const { app, dispatch } = useStore();
  const [text, setText] = useState(app.today.text);
  return (
    <Shell title="What is today for?" onClose={() => dispatch({ type: "dayPrompt", open: false })}>
      <p className="modal-lede">The objective is injected as context into every session you start today, and reconciled against what actually happened when you close.</p>
      <label className="field">
        <textarea autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="modal-actions">
        <button className="btn" onClick={() => dispatch({ type: "dayPrompt", open: false })}>Cancel</button>
        <button className="btn btn-primary" onClick={() => dispatch({ type: "setObjective", text })}>Set objective</button>
      </div>
    </Shell>
  );
}

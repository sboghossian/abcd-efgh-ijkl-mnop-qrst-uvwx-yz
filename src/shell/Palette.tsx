import { useMemo, useState } from "react";
import { useStore } from "../lib/store";
import type { SurfaceId } from "../lib/types";

interface Cmd { group: string; label: string; hint?: string; run: () => void; }

export function Palette() {
  const { app, dispatch } = useStore();
  const [q, setQ] = useState("");

  const cmds = useMemo<Cmd[]>(() => {
    const jump: [SurfaceId, string, string][] = [
      ["home", "Home", "⌘1"], ["groups", "Groups", "⌘2"], ["kanban", "Board", "⌘3"],
      ["brain", "Brain", "⌘4"], ["system", "System architecture", "⌘5"],
      ["dashboard", "Dashboard", "⌘6"], ["settings", "Settings", "⌘7"], ["docs", "Documentation", "⌘8"],
    ];
    return [
      { group: "Actions", label: "New session", hint: "⌘N", run: () => dispatch({ type: "newSessionModal", open: true }) },
      { group: "Actions", label: "Wind down the day", run: () => dispatch({ type: "windDown", open: true }) },
      { group: "Actions", label: "Resume every session", run: () => dispatch({ type: "resumeAll" }) },
      { group: "Actions", label: "Set today's objective", run: () => dispatch({ type: "dayPrompt", open: true }) },
      ...jump.map(([id, label, hint]) => ({ group: "Jump to", label, hint, run: () => dispatch({ type: "surface", id }) })),
      ...app.groups.map((g) => ({ group: "Groups", label: g.name, run: () => dispatch({ type: "group", id: g.id }) })),
      ...app.sessions.slice(0, 12).map((s) => ({
        group: "Sessions", label: s.title, hint: s.shortId,
        run: () => { dispatch({ type: "group", id: s.groupId }); dispatch({ type: "activate", columnId: s.columnId, sessionId: s.id }); },
      })),
    ];
  }, [app.groups, app.sessions, dispatch]);

  const hits = q.trim()
    ? cmds.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()))
    : cmds.filter((c) => c.group !== "Sessions");

  const grouped = hits.reduce<Record<string, Cmd[]>>((acc, c) => {
    (acc[c.group] ??= []).push(c);
    return acc;
  }, {});

  return (
    <div className="overlay" onClick={() => dispatch({ type: "palette", open: false })}>
      <div className="palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a command or search sessions…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && hits[0]) { hits[0].run(); dispatch({ type: "palette", open: false }); }
          }} />
        <div className="palette-list scroll">
          {Object.entries(grouped).map(([g, items]) => (
            <div key={g}>
              <div className="eyebrow palette-group">{g}</div>
              {items.map((c, i) => (
                <button key={`${g}-${i}`} className="palette-row" onClick={() => { c.run(); dispatch({ type: "palette", open: false }); }}>
                  <span>{c.label}</span>
                  {c.hint && <span className="mono palette-hint">{c.hint}</span>}
                </button>
              ))}
            </div>
          ))}
          {hits.length === 0 && <div className="palette-empty">Nothing matches “{q}”.</div>}
        </div>
        <div className="palette-foot mono">↑↓ navigate · ↵ select · esc dismiss</div>
      </div>
    </div>
  );
}

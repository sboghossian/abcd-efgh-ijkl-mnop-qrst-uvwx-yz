import "./Brain.css";
import { useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { useStore } from "../lib/store";
import type { VaultNote } from "../lib/types";
import { relTime } from "../lib/format";
import { GroupGlyph } from "../lib/glyph";

const MAX_RENDER = 200;
const REAL_VAULT_SIZE = "60,800";

export function Brain() {
  const { ui, dispatch } = useStore();
  return (
    <div className="surface-pad br-page">
      <div className="br-tabs" role="tablist" aria-label="Brain view">
        <button
          type="button"
          role="tab"
          aria-selected={ui.brainTab === "lobe"}
          className={`br-tab${ui.brainTab === "lobe" ? " on" : ""}`}
          onClick={() => dispatch({ type: "brainTab", tab: "lobe" })}
        >
          Lobe
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={ui.brainTab === "vault"}
          className={`br-tab${ui.brainTab === "vault" ? " on" : ""}`}
          onClick={() => dispatch({ type: "brainTab", tab: "vault" })}
        >
          Vault
        </button>
      </div>

      {ui.brainTab === "lobe" ? <LobeTab /> : <VaultTab />}
    </div>
  );
}

/* ================= Lobe tab ================= */

function LobeTab() {
  const { app, ui } = useStore();

  const activeSessionId = ui.promptTarget ?? app.sessions[0]?.id;
  const session = activeSessionId ? app.sessions.find((s) => s.id === activeSessionId) : undefined;
  const group = session ? app.groups.find((g) => g.id === session.groupId) : undefined;
  const groupKey = group?.name.toLowerCase() ?? "";

  const { inContext, oneLinkAway } = useMemo(() => {
    if (!groupKey) return { inContext: [] as VaultNote[], oneLinkAway: [] as VaultNote[] };
    const matches = (n: VaultNote) =>
      n.tags.some((tag) => tag.toLowerCase().includes(groupKey)) ||
      n.path.toLowerCase().includes(groupKey) ||
      n.title.toLowerCase().includes(groupKey);
    const first = app.notes.filter(matches);
    const firstPaths = new Set(first.map((n) => n.path));
    const linked = new Set<string>();
    for (const n of first) for (const l of n.links) if (!firstPaths.has(l)) linked.add(l);
    const second = app.notes.filter((n) => linked.has(n.path));
    return { inContext: first, oneLinkAway: second };
  }, [app.notes, groupKey]);

  if (!session || !group) {
    return <p className="empty">No active session — open one from Groups or the Board to see its brain context.</p>;
  }

  return (
    <div className="br-lobe">
      <p className="br-explain prose">
        Notes related to the part of the vault <strong className="mono">{session.title}</strong> is drawing on
        — matched loosely against the group <strong>{group.name}</strong>&rsquo;s name in tags, paths and
        titles, plus one hop of links out from those notes.
      </p>

      <div className="br-lobe-group">
        <GroupGlyph seed={group.glyphSeed} size={14} />
        <span>{group.name}</span>
      </div>

      <section className="br-tier">
        <p className="eyebrow">In context — {inContext.length}</p>
        {inContext.length === 0 ? (
          <p className="empty">Nothing in the vault matches this group yet.</p>
        ) : (
          <div className="br-note-grid">
            {inContext.map((n) => (
              <NoteCard key={n.path} note={n} />
            ))}
          </div>
        )}
      </section>

      <section className="br-tier">
        <p className="eyebrow">One link away — {oneLinkAway.length}</p>
        {oneLinkAway.length === 0 ? (
          <p className="empty">No linked notes one hop out.</p>
        ) : (
          <div className="br-note-grid">
            {oneLinkAway.map((n) => (
              <NoteCard key={n.path} note={n} muted />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function NoteCard({ note, muted = false }: { note: VaultNote; muted?: boolean }) {
  return (
    <article className={`panel-card br-note-card${muted ? " muted" : ""}`}>
      <div className="br-note-card-head">
        <p className="br-note-title">{note.title}</p>
        <span className="chip">{note.folder}</span>
      </div>
      <div className="br-note-tags">
        {note.tags.map((t) => (
          <span key={t} className="mono br-tag">
            {t}
          </span>
        ))}
      </div>
      <p className="br-note-excerpt prose">{note.excerpt}</p>
      <p className="br-note-updated mono">{relTime(note.updatedAt)}</p>
    </article>
  );
}

/* ================= Vault tab ================= */

function VaultTab() {
  const { app } = useStore();
  const [search, setSearch] = useState("");
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const folderCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of app.notes) map.set(n.folder, (map.get(n.folder) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [app.notes]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return app.notes.filter((n) => {
      if (selectedFolder && n.folder !== selectedFolder) return false;
      if (!query) return true;
      const hay = `${n.title} ${n.path} ${n.tags.join(" ")} ${n.excerpt}`.toLowerCase();
      return hay.includes(query);
    });
  }, [app.notes, search, selectedFolder]);

  const visible = filtered.slice(0, MAX_RENDER);
  const activeNote = (selectedPath && app.notes.find((n) => n.path === selectedPath)) || visible[0];

  const backlinks = useMemo(
    () => (activeNote ? app.notes.filter((n) => n.links.includes(activeNote.path)) : []),
    [app.notes, activeNote],
  );

  return (
    <div className="br-vault-wrap">
      <p className="br-scale mono">
        {app.notes.length} notes in this fixture — the real vault holds {REAL_VAULT_SIZE} notes. Backlinks are
        read from pre-computed Smart Connections footers, not recomputed here.
      </p>

      <div className="br-vault">
        <nav className="br-tree scroll" aria-label="Vault folders">
          <button
            type="button"
            className={`br-tree-item${selectedFolder === null ? " on" : ""}`}
            onClick={() => setSelectedFolder(null)}
          >
            <span>All notes</span>
            <span className="mono">{app.notes.length}</span>
          </button>
          {folderCounts.map(([folder, count]) => (
            <button
              key={folder}
              type="button"
              className={`br-tree-item${selectedFolder === folder ? " on" : ""}`}
              onClick={() => setSelectedFolder((cur) => (cur === folder ? null : folder))}
            >
              <span className="mono">{folder}</span>
              <span className="mono">{count}</span>
            </button>
          ))}
        </nav>

        <div className="br-center">
          <input
            type="search"
            className="br-search"
            placeholder="Search title, path, tags, excerpt"
            aria-label="Search vault notes"
            value={search}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          />
          <p className="br-count mono">
            Showing {visible.length} of {filtered.length}
            {filtered.length !== app.notes.length ? ` (${app.notes.length} total)` : ""}
          </p>
          <ul className="br-list scroll">
            {visible.length === 0 && <li className="empty">No notes match this search.</li>}
            {visible.map((n) => (
              <li key={n.path}>
                <button
                  type="button"
                  className={`br-note-row${activeNote?.path === n.path ? " on" : ""}`}
                  onClick={() => setSelectedPath(n.path)}
                >
                  <span className="br-note-row-title">{n.title}</span>
                  <span className="br-note-row-path mono">{n.path}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <aside className="br-inspector">
          {activeNote ? (
            <>
              <p className="eyebrow">Note</p>
              <h3 className="br-inspector-title">{activeNote.title}</h3>
              <p className="mono br-inspector-path">{activeNote.path}</p>
              <div className="br-note-tags">
                {activeNote.tags.map((t) => (
                  <span key={t} className="mono br-tag">
                    {t}
                  </span>
                ))}
              </div>
              <p className="br-inspector-excerpt prose">{activeNote.excerpt}</p>
              <p className="eyebrow">Updated</p>
              <p className="mono">{relTime(activeNote.updatedAt)}</p>

              <p className="eyebrow">Backlinks — {backlinks.length}</p>
              {backlinks.length === 0 ? (
                <p className="br-inspector-empty">No notes link here.</p>
              ) : (
                <ul className="br-linklist">
                  {backlinks.map((b) => (
                    <li key={b.path}>
                      <button type="button" className="br-link mono" onClick={() => setSelectedPath(b.path)}>
                        {b.path}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <p className="eyebrow">Forward links — {activeNote.links.length}</p>
              {activeNote.links.length === 0 ? (
                <p className="br-inspector-empty">This note links nowhere.</p>
              ) : (
                <ul className="br-linklist">
                  {activeNote.links.map((path) => {
                    const target = app.notes.find((n) => n.path === path);
                    return (
                      <li key={path}>
                        {target ? (
                          <button type="button" className="br-link mono" onClick={() => setSelectedPath(path)}>
                            {path}
                          </button>
                        ) : (
                          <span className="br-link mono br-link-missing">{path}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          ) : (
            <p className="empty">No note selected.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

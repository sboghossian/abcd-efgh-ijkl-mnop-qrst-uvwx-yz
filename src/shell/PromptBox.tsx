import { useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { IconSend, IconMic, IconPaperclip, IconGhost } from "./icons";
import { shortModel } from "../lib/format";

/**
 * One prompt box for every session. Routes by explicit target or @ tag.
 * Null target means broadcast. Tier-3 targets are marked unreachable
 * rather than silently dropping the message.
 */
export function PromptBox() {
  const { app, ui, dispatch } = useStore();
  const [tagOpen, setTagOpen] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const target = app.sessions.find((s) => s.id === ui.promptTarget) ?? null;
  const unreachable = target?.tier === 3;
  const broadcastCount = app.sessions.filter((s) => s.tier !== 3).length;

  const matches = useMemo(() => {
    const m = /@(\w*)$/.exec(ui.promptText);
    if (!m) return null;
    const q = (m[1] ?? "").toLowerCase();
    return app.sessions.filter((s) => s.title.toLowerCase().includes(q) || s.shortId.startsWith(q)).slice(0, 6);
  }, [ui.promptText, app.sessions]);

  const send = () => {
    if (!ui.promptText.trim() || unreachable) return;
    dispatch({ type: "sendPrompt" });
  };

  return (
    <div className="promptwrap">
      {(tagOpen || matches) && (matches?.length ?? 0) > 0 && (
        <div className="tagmenu">
          {matches!.map((s) => (
            <button key={s.id} onClick={() => {
              dispatch({ type: "promptTarget", id: s.id });
              dispatch({ type: "promptText", text: ui.promptText.replace(/@\w*$/, "") });
              setTagOpen(false);
              ref.current?.focus();
            }}>
              <span className={`dot s-${s.status}`} />
              <span className="tag-title">{s.title}</span>
              <span className="mono tag-id">{s.shortId}</span>
            </button>
          ))}
        </div>
      )}

      <div className={`promptbox${unreachable ? " unreachable" : ""}`}>
        <div className="prompt-target">
          <button className="target-chip" onClick={() => dispatch({ type: "promptTarget", id: null })} title="Send to every reachable session">
            {target ? (
              <>
                <span className={`dot s-${target.status}`} />
                <span className="target-name">{target.title}</span>
                {target.incognito && <IconGhost />}
                <span className="mono target-model">{shortModel(target.model)}</span>
              </>
            ) : (
              <>
                <span className="dot" style={{ background: "var(--wire)" }} />
                <span className="target-name">Broadcast</span>
                <span className="mono target-model">{broadcastCount} sessions</span>
              </>
            )}
          </button>
          {unreachable && <span className="mono unreach-note">Read-only · tier 3, cannot receive</span>}
        </div>

        <textarea
          ref={ref}
          rows={1}
          className="prompt-input"
          placeholder={target ? `Message ${target.title}…  @ to retarget, / for settings` : "Message every reachable session…"}
          value={ui.promptText}
          onChange={(e) => dispatch({ type: "promptText", text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            if (e.key === "@") setTagOpen(true);
          }}
        />

        <div className="prompt-actions">
          <button className="btn-ghost pbtn" title="Attach a file" aria-label="Attach a file"><IconPaperclip /></button>
          <button className={`btn-ghost pbtn${ui.dictating ? " rec" : ""}`} title="Dictate — local whisper.cpp, audio never leaves the machine"
            aria-label="Dictate" aria-pressed={ui.dictating} onClick={() => dispatch({ type: "dictate", on: !ui.dictating })}>
            <IconMic />
          </button>
          {ui.dictating && <span className="mono rec-note">whisper.cpp · local</span>}
          <button className="btn btn-primary pbtn-send" onClick={send} disabled={!ui.promptText.trim() || unreachable}>
            <IconSend />
          </button>
        </div>
      </div>
    </div>
  );
}

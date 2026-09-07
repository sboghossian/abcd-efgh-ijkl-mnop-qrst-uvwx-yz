import { useEffect } from "react";
import { useStore } from "../lib/store";
import { IconClose } from "./icons";

/**
 * Automatic grouping raises a toast with a single undo. Decision 13.
 * Undo pins the session so re-inference never overrides the correction.
 */
export function Toasts() {
  const { app, ui, dispatch } = useStore();

  // A grouping toast is an interruption, not a record. It clears itself so it
  // never sits on top of the work underneath.
  useEffect(() => {
    if (ui.toasts.length === 0) return;
    const timers = ui.toasts.map((t) =>
      window.setTimeout(() => dispatch({ type: "dismissToast", id: t.id }), 9000),
    );
    return () => timers.forEach(window.clearTimeout);
  }, [ui.toasts, dispatch]);

  if (ui.toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {ui.toasts.map((t) => {
        const group = app.groups.find((g) => g.id === t.toGroupId);
        return (
          <div key={t.id} className="toast">
            <div className="toast-body">
              <span className="eyebrow">Grouped automatically</span>
              <p><strong>{t.sessionTitle}</strong> was filed into <strong>{group?.name ?? "a group"}</strong>.</p>
            </div>
            <button className="btn" onClick={() => dispatch({ type: "undoGrouping", id: t.id })}>Undo</button>
            <button className="btn-ghost pbtn" aria-label="Dismiss" onClick={() => dispatch({ type: "dismissToast", id: t.id })}>
              <IconClose />
            </button>
          </div>
        );
      })}
    </div>
  );
}

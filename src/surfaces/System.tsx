import "./System.css";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import type { SystemEdge, SystemNode, SystemNodeKind } from "../lib/types";
import { IconClose } from "../shell/icons";

/** Fixed card footprint in stage units — x/y from the fixtures are card centers. */
const NODE_W = 156;
const NODE_H = 78;
const STAGE_PAD = 110;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2;

const KIND_LABEL: Record<SystemNodeKind, string> = {
  memory: "Memory",
  skill: "Skill",
  agent: "Agent",
  hook: "Hook",
  connector: "Connector",
  routine: "Routine",
  machine: "Machine",
  runtime: "Runtime",
};

const EDGE_LABEL: Record<SystemEdge["kind"], string> = {
  reads: "reads",
  writes: "writes",
  triggers: "triggers",
  depends: "depends on",
};

/** Different dash pattern per edge kind — "reads" is solid. */
const EDGE_DASH: Record<SystemEdge["kind"], string | undefined> = {
  reads: undefined,
  writes: "7 5",
  triggers: "1.5 5",
  depends: "1.5 4 8 4",
};

const STATUS_VAR: Record<SystemNode["status"], string> = {
  ok: "var(--run)",
  warn: "var(--wait)",
  off: "var(--idle)",
};

/** Stable hue per kind name, so the canvas reads as wayfinding without a fixed palette. */
function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}
function accentFor(kind: string): string {
  return `hsl(${hueFor(kind)} 58% 45%)`;
}

function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

interface Pt {
  x: number;
  y: number;
}

interface View {
  zoom: number;
  panX: number;
  panY: number;
}

function curvePath(a: Pt, b: Pt): { d: string; mid: Pt } {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = -dy / dist;
  const ny = dx / dist;
  const bend = Math.min(46, dist * 0.22);
  const cx = mx + nx * bend;
  const cy = my + ny * bend;
  return {
    d: `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`,
    mid: { x: 0.25 * a.x + 0.5 * cx + 0.25 * b.x, y: 0.25 * a.y + 0.5 * cy + 0.25 * b.y },
  };
}

function NodeCard({ node, pos, onOpen }: { node: SystemNode; pos: Pt; onOpen: (id: string) => void }) {
  const accent = accentFor(node.kind);
  return (
    <button
      type="button"
      className="sys-node"
      style={{ left: pos.x - NODE_W / 2, top: pos.y - NODE_H / 2, width: NODE_W, height: NODE_H, borderLeftColor: accent }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => onOpen(node.id)}
      title={`${node.label} — ${node.detail}`}
    >
      <span className="sys-node-top">
        <span className="sys-node-swatch" aria-hidden="true" style={{ background: accent }} />
        <span className="eyebrow sys-node-kind">{KIND_LABEL[node.kind]}</span>
        <span className="dot" style={{ color: STATUS_VAR[node.status] }} title={`status: ${node.status}`} />
      </span>
      <span className="sys-node-label">{node.label}</span>
      <span className="mono sys-node-detail">{node.detail}</span>
    </button>
  );
}

function Inspector({
  node,
  edges,
  nodesById,
  onClose,
  onJump,
}: {
  node: SystemNode;
  edges: SystemEdge[];
  nodesById: Map<string, SystemNode>;
  onClose: () => void;
  onJump: (id: string) => void;
}) {
  const inbound = edges.filter((e) => e.to === node.id);
  const outbound = edges.filter((e) => e.from === node.id);
  const metaEntries = Object.entries(node.meta);

  return (
    <aside className="sys-inspector" role="dialog" aria-label={`${node.label} details`}>
      <div className="sys-inspector-head">
        <div>
          <span className="eyebrow">{KIND_LABEL[node.kind]}</span>
          <h3>{node.label}</h3>
        </div>
        <button className="sys-inspector-close" aria-label="Close inspector" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div className="sys-inspector-body scroll">
        <p className="sys-inspector-detail mono">{node.detail}</p>
        <div className="sys-inspector-status">
          <span className="dot" style={{ color: STATUS_VAR[node.status] }} />
          <span className="mono">{node.status}</span>
        </div>

        {metaEntries.length > 0 && (
          <table className="sys-meta mono">
            <tbody>
              {metaEntries.map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="sys-inspector-edges">
          <span className="eyebrow">Inbound · {inbound.length}</span>
          <ul>
            {inbound.map((e, i) => {
              const other = nodesById.get(e.from);
              return (
                <li key={`in-${i}`}>
                  <button className="mono sys-edge-link" onClick={() => other && onJump(other.id)}>
                    {other?.label ?? e.from}
                  </button>
                  <span className="eyebrow">{EDGE_LABEL[e.kind]}</span>
                </li>
              );
            })}
            {inbound.length === 0 && <li className="sys-edge-none">None</li>}
          </ul>
          <span className="eyebrow">Outbound · {outbound.length}</span>
          <ul>
            {outbound.map((e, i) => {
              const other = nodesById.get(e.to);
              return (
                <li key={`out-${i}`}>
                  <span className="eyebrow">{EDGE_LABEL[e.kind]}</span>
                  <button className="mono sys-edge-link" onClick={() => other && onJump(other.id)}>
                    {other?.label ?? e.to}
                  </button>
                </li>
              );
            })}
            {outbound.length === 0 && <li className="sys-edge-none">None</li>}
          </ul>
        </div>
      </div>
      <p className="sys-inspector-honest">
        Editing is disabled in this mock. A real edit here would go through a gated action endpoint that changes the
        actual configuration — this view never writes to it directly.
      </p>
    </aside>
  );
}

function Legend({ kinds }: { kinds: SystemNodeKind[] }) {
  const edgeKinds = Object.keys(EDGE_LABEL) as SystemEdge["kind"][];
  return (
    <div className="sys-legend">
      <div className="sys-legend-col">
        <span className="eyebrow">Node kind</span>
        {kinds.map((k) => (
          <span key={k} className="sys-legend-row">
            <span className="sys-legend-swatch" style={{ background: accentFor(k) }} />
            {KIND_LABEL[k]}
          </span>
        ))}
      </div>
      <div className="sys-legend-col">
        <span className="eyebrow">Edge kind</span>
        {edgeKinds.map((k) => (
          <span key={k} className="sys-legend-row">
            <svg width="26" height="8" aria-hidden="true">
              <line x1="1" y1="4" x2="25" y2="4" stroke="var(--ink-3)" strokeWidth={1.6} strokeDasharray={EDGE_DASH[k]} />
            </svg>
            {EDGE_LABEL[k]}
          </span>
        ))}
      </div>
      <div className="sys-legend-col">
        <span className="eyebrow">Status</span>
        <span className="sys-legend-row"><span className="dot" style={{ color: "var(--run)" }} /> ok</span>
        <span className="sys-legend-row"><span className="dot" style={{ color: "var(--wait)" }} /> warn</span>
        <span className="sys-legend-row"><span className="dot" style={{ color: "var(--idle)" }} /> off</span>
      </div>
    </div>
  );
}

export function SystemCanvas() {
  const { app, ui, dispatch } = useStore();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, panX: 0, panY: 0 });
  const [hoverEdge, setHoverEdge] = useState<number | null>(null);

  const nodesById = useMemo(() => new Map(app.systemNodes.map((n) => [n.id, n])), [app.systemNodes]);

  const positions = useMemo(() => {
    const m = new Map<string, Pt>();
    for (const n of app.systemNodes) m.set(n.id, { x: n.x + STAGE_PAD, y: n.y + STAGE_PAD });
    return m;
  }, [app.systemNodes]);

  const bounds = useMemo(() => {
    let maxX = 0;
    let maxY = 0;
    for (const n of app.systemNodes) {
      maxX = Math.max(maxX, n.x);
      maxY = Math.max(maxY, n.y);
    }
    return { w: maxX + STAGE_PAD * 2 + NODE_W, h: maxY + STAGE_PAD * 2 + NODE_H };
  }, [app.systemNodes]);

  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const cw = el.clientWidth || 1;
    const ch = el.clientHeight || 1;
    // Fitting to a short viewport can zoom out past legibility. Never auto-fit
    // below 0.75 — a canvas you cannot read is worse than one you must pan.
    const z = Math.min(1.1, Math.max(0.75, clampZoom(Math.min(cw / bounds.w, ch / bounds.h))));
    setView({ zoom: z, panX: (cw - bounds.w * z) / 2, panY: (ch - bounds.h * z) / 2 });
  }, [bounds]);

  useLayoutEffect(() => {
    fit();
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const zoomAt = useCallback((nextZoomRaw: number, anchorX: number, anchorY: number) => {
    setView((v) => {
      const nextZoom = clampZoom(nextZoomRaw);
      const contentX = (anchorX - v.panX) / v.zoom;
      const contentY = (anchorY - v.panY) / v.zoom;
      return { zoom: nextZoom, panX: anchorX - contentX * nextZoom, panY: anchorY - contentY * nextZoom };
    });
  }, []);

  const zoomButton = useCallback(
    (step: number) => {
      const el = wrapRef.current;
      const cw = el?.clientWidth ?? 0;
      const ch = el?.clientHeight ?? 0;
      zoomAt(view.zoom + step, cw / 2, ch / 2);
    },
    [zoomAt, view.zoom],
  );

  const onBgPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY };
  };
  const onBgPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    setView((v) => ({ ...v, panX: d.panX + dx, panY: d.panY + dy }));
  };
  const onBgPointerUp = () => {
    dragRef.current = null;
  };
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    zoomAt(view.zoom - e.deltaY * 0.0016, e.clientX - rect.left, e.clientY - rect.top);
  };

  const presentKinds = useMemo(
    () => Array.from(new Set(app.systemNodes.map((n) => n.kind))),
    [app.systemNodes],
  );

  const inspected = ui.inspectorNodeId ? nodesById.get(ui.inspectorNodeId) ?? null : null;

  return (
    <div className="sys">
      <div className="sys-head">
        <div className="sys-head-l">
          <span className="eyebrow">System architecture</span>
          <p className="sys-honest">
            Editing a node here edits the real configuration behind it, through a gated action endpoint — in this
            mock, editing is disabled.
          </p>
        </div>
        <div className="sys-controls mono" role="group" aria-label="Canvas zoom">
          <button className="btn btn-ghost" aria-label="Zoom out" onClick={() => zoomButton(-0.2)}>
            −
          </button>
          <span className="sys-zoom-pct">{Math.round(view.zoom * 100)}%</span>
          <button className="btn btn-ghost" aria-label="Zoom in" onClick={() => zoomButton(0.2)}>
            +
          </button>
          <button className="btn" aria-label="Fit to screen" onClick={fit}>
            Fit
          </button>
        </div>
      </div>

      <div
        className="sys-canvas"
        ref={wrapRef}
        onPointerDown={onBgPointerDown}
        onPointerMove={onBgPointerMove}
        onPointerUp={onBgPointerUp}
        onPointerLeave={onBgPointerUp}
        onWheel={onWheel}
      >
        {app.systemNodes.length === 0 ? (
          <p className="sys-empty">No system nodes reported.</p>
        ) : (
          <div
            className="sys-stage"
            style={{ width: bounds.w, height: bounds.h, transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}
          >
            <svg className="sys-svg" width={bounds.w} height={bounds.h} aria-hidden="true">
              {app.systemEdges.map((edge, i) => {
                const a = positions.get(edge.from);
                const b = positions.get(edge.to);
                if (!a || !b) return null;
                const { d, mid } = curvePath(a, b);
                const active = hoverEdge === i;
                return (
                  <g key={`${edge.from}-${edge.to}-${i}`}>
                    <path
                      d={d}
                      fill="none"
                      stroke={active ? "var(--wire)" : "var(--line-strong)"}
                      strokeWidth={active ? 2 : 1.4}
                      strokeDasharray={EDGE_DASH[edge.kind]}
                    />
                    <path
                      d={d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={14}
                      style={{ pointerEvents: "stroke", cursor: "pointer" }}
                      onPointerEnter={() => setHoverEdge(i)}
                      onPointerLeave={() => setHoverEdge((h) => (h === i ? null : h))}
                    />
                    {active && (
                      <text
                        x={mid.x}
                        y={mid.y - 4}
                        textAnchor="middle"
                        className="sys-edge-label"
                        stroke="var(--surface)"
                        strokeWidth={4}
                        paintOrder="stroke"
                        fill="var(--wire)"
                      >
                        {EDGE_LABEL[edge.kind]}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            {app.systemNodes.map((n) => {
              const pos = positions.get(n.id);
              if (!pos) return null;
              return <NodeCard key={n.id} node={n} pos={pos} onOpen={(id) => dispatch({ type: "inspect", id })} />;
            })}
          </div>
        )}

        {inspected && (
          <Inspector
            node={inspected}
            edges={app.systemEdges}
            nodesById={nodesById}
            onClose={() => dispatch({ type: "inspect", id: null })}
            onJump={(id) => dispatch({ type: "inspect", id })}
          />
        )}
      </div>

      <Legend kinds={presentKinds} />
    </div>
  );
}

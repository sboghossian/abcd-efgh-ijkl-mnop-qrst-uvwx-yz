import "./Dashboard.css";
import { useMemo } from "react";
import { useStore } from "../lib/store";
import type { UsageDay } from "../lib/types";
import { compactNum, usd } from "../lib/format";

/* ---------------- pure helpers ---------------- */

function sumUsage(days: UsageDay[]): { sessions: number; tokens: number; cost: number } {
  let sessions = 0;
  let tokens = 0;
  let cost = 0;
  for (const d of days) {
    sessions += d.sessions;
    tokens += d.tokens;
    cost += d.costEstimateUsd;
  }
  return { sessions, tokens, cost };
}

function streakAndActive(days: UsageDay[]): { active: number; streak: number } {
  let active = 0;
  for (const d of days) if (d.sessions > 0) active++;
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const day = days[i];
    if (!day || day.sessions <= 0) break;
    streak++;
  }
  return { active, streak };
}

interface HeatCell {
  date: string;
  sessions: number;
  tokens: number;
  level: number;
}

function levelFor(sessions: number, max: number): number {
  if (sessions <= 0) return 0;
  if (max <= 0) return 1;
  const r = sessions / max;
  if (r > 0.75) return 4;
  if (r > 0.5) return 3;
  if (r > 0.25) return 2;
  return 1;
}

interface MonthMark {
  week: number;
  label: string;
}

function buildHeatWeeks(days: UsageDay[]): { weeks: (HeatCell | null)[][]; monthMarks: MonthMark[] } {
  const max = days.reduce((m, d) => Math.max(m, d.sessions), 0);
  const cells: (HeatCell | null)[] = [];
  const first = days[0];
  if (first) {
    const firstDow = new Date(`${first.date}T00:00:00`).getDay();
    for (let i = 0; i < firstDow; i++) cells.push(null);
  }
  for (const d of days) {
    cells.push({ date: d.date, sessions: d.sessions, tokens: d.tokens, level: levelFor(d.sessions, max) });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (HeatCell | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const monthMarks: MonthMark[] = [];
  let lastMonth = -1;
  weeks.forEach((week, wi) => {
    const firstCell = week.find((c): c is HeatCell => c !== null);
    if (!firstCell) return;
    const m = new Date(`${firstCell.date}T00:00:00`).getMonth();
    if (m !== lastMonth) {
      monthMarks.push({ week: wi, label: new Date(`${firstCell.date}T00:00:00`).toLocaleDateString(undefined, { month: "short" }) });
      lastMonth = m;
    }
  });

  return { weeks, monthMarks };
}

const WEEKDAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

/* ---------------- heatmap ---------------- */

function Heatmap({ weeks, monthMarks }: { weeks: (HeatCell | null)[][]; monthMarks: MonthMark[] }) {
  return (
    <div className="heat-wrap scroll">
      <div className="heat-inner">
        <div className="heat-daylabels">
          <span className="heat-daylabel-spacer" />
          {WEEKDAY_LABELS.map((label, i) => (
            <span key={i} className="mono heat-daylabel">{label}</span>
          ))}
        </div>
        <div className="heat-main">
          <div className="heat-months">
            {weeks.map((_, wi) => {
              const mark = monthMarks.find((m) => m.week === wi);
              return (
                <span key={wi} className="heat-month">{mark ? mark.label : ""}</span>
              );
            })}
          </div>
          <div className="heat-weeks">
            {weeks.map((week, wi) => (
              <div key={wi} className="heat-col">
                {week.map((cell, di) => (
                  <span
                    key={di}
                    className={cell ? `heat-cell level-${cell.level}` : "heat-cell heat-blank"}
                    title={cell ? `${cell.date} — ${cell.sessions} session${cell.sessions === 1 ? "" : "s"}, ${compactNum(cell.tokens)} tokens` : undefined}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- stat rail ---------------- */

function StatRail({ stats }: { stats: { sessions: number; tokens: number; cost: number; active: number; streak: number } }) {
  return (
    <div className="stat-rail panel-card">
      <div className="stat">
        <span className="mono stat-n">{stats.sessions}</span>
        <span className="eyebrow">sessions · 182d</span>
      </div>
      <div className="stat">
        <span className="mono stat-n">{compactNum(stats.tokens)}</span>
        <span className="eyebrow">tokens</span>
      </div>
      <div className="stat">
        <span className="mono stat-n">
          {usd(stats.cost)}
          <span className="stat-est">est.</span>
        </span>
        <span className="eyebrow">cost</span>
      </div>
      <div className="stat">
        <span className="mono stat-n">{stats.active}</span>
        <span className="eyebrow">active days</span>
      </div>
      <div className="stat">
        <span className="mono stat-n">{stats.streak}</span>
        <span className="eyebrow">day streak</span>
      </div>
    </div>
  );
}

/* ---------------- daily token chart ---------------- */

function fmtChartDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function TokenChart({ days }: { days: UsageDay[] }) {
  const w = 640;
  const h = 200;
  const padL = 48;
  const padR = 16;
  const padT = 16;
  const padB = 26;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const max = days.reduce((m, d) => Math.max(m, d.tokens), 0) || 1;
  const stepX = days.length > 1 ? innerW / (days.length - 1) : 0;
  const pts = days.map((d, i) => ({ x: padL + i * stepX, y: padT + innerH - (d.tokens / max) * innerH }));
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const lastPt = pts[pts.length - 1];
  const area = `${line} L ${(lastPt?.x ?? padL).toFixed(1)} ${(padT + innerH).toFixed(1)} L ${padL} ${(padT + innerH).toFixed(1)} Z`;

  const first = days[0];
  const last = days[days.length - 1];
  const mid = days[Math.floor((days.length - 1) / 2)];

  return (
    <svg className="tok-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Daily tokens, last 30 days">
      {[0, 0.5, 1].map((f) => {
        const y = padT + innerH * (1 - f);
        const val = Math.round(max * f);
        return (
          <g key={f}>
            <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="var(--line)" strokeWidth={1} />
            <text x={padL - 8} y={y + 3} textAnchor="end" className="tok-axis mono" fill="var(--ink-3)">
              {compactNum(val)}
            </text>
          </g>
        );
      })}
      <path d={area} fill="var(--wire-soft)" stroke="none" />
      <path d={line} fill="none" stroke="var(--wire)" strokeWidth={1.8} />
      {first && (
        <text x={padL} y={h - 8} textAnchor="start" className="tok-axis mono" fill="var(--ink-3)">
          {fmtChartDate(first.date)}
        </text>
      )}
      {mid && mid !== first && mid !== last && (
        <text x={padL + innerW / 2} y={h - 8} textAnchor="middle" className="tok-axis mono" fill="var(--ink-3)">
          {fmtChartDate(mid.date)}
        </text>
      )}
      {last && (
        <text x={w - padR} y={h - 8} textAnchor="end" className="tok-axis mono" fill="var(--ink-3)">
          {fmtChartDate(last.date)}
        </text>
      )}
    </svg>
  );
}

/* ---------------- spend by group ---------------- */

interface SpendRow {
  id: string;
  name: string;
  cost: number;
}

function SpendByGroup({ rows }: { rows: SpendRow[] }) {
  const max = rows.reduce((m, r) => Math.max(m, r.cost), 0) || 1;
  if (rows.length === 0) return <div className="empty panel-card">No sessions yet.</div>;
  return (
    <div className="spend panel-card">
      {rows.map((r) => (
        <div key={r.id} className="spend-row">
          <span className="spend-name">{r.name}</span>
          <div className="spend-bar-track">
            <div className="spend-bar" style={{ width: `${(r.cost / max) * 100}%` }} />
          </div>
          <span className="mono spend-val">
            {usd(r.cost)}
            <span className="stat-est">est.</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------------- token composition ---------------- */

interface TokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

function TokenComposition({ comp }: { comp: TokenTotals }) {
  const total = comp.input + comp.output + comp.cacheRead + comp.cacheWrite || 1;
  const segs = [
    { key: "input", label: "Input", value: comp.input, color: "var(--wire)" },
    { key: "output", label: "Output", value: comp.output, color: "var(--run)" },
    { key: "cacheRead", label: "Cache read", value: comp.cacheRead, color: "var(--wait)" },
    { key: "cacheWrite", label: "Cache write", value: comp.cacheWrite, color: "var(--incognito)" },
  ] as const;

  return (
    <div className="comp panel-card">
      <div className="comp-bar">
        {segs.map((s) => (
          <div
            key={s.key}
            className="comp-seg"
            style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
            title={`${s.label}: ${compactNum(s.value)} tokens (${((s.value / total) * 100).toFixed(1)}%)`}
          />
        ))}
      </div>
      <div className="comp-legend mono">
        {segs.map((s) => (
          <span key={s.key} className="comp-legend-item">
            <span className="comp-swatch" style={{ background: s.color }} />
            {s.label} · {compactNum(s.value)} ({((s.value / total) * 100).toFixed(0)}%)
          </span>
        ))}
      </div>
      <p className="comp-note">
        Cache read is usually the largest share — that is expected on a subscription. It is context you already paid
        to load, replayed cheaply on later turns, not fresh spend.
      </p>
    </div>
  );
}

/* ---------------- widget catalogue ---------------- */

const CATALOGUE: { name: string; desc: string }[] = [
  { name: "Model mix", desc: "Share of sessions by model, over any range." },
  { name: "Tool-call frequency", desc: "Which tools fire most, and how often they fail." },
  { name: "Failure rate", desc: "Sessions ending failed vs. completed, trended over time." },
  { name: "Session length distribution", desc: "Histogram of how long sessions run before closing." },
  { name: "Idle time", desc: "Time between activity within a session, aggregated." },
  { name: "Hook timings", desc: "Slowest hooks by event, p50 and p95." },
];

function WidgetCatalogue() {
  return (
    <div className="catalogue">
      {CATALOGUE.map((w) => (
        <div key={w.name} className="cat-card panel-card">
          <span className="cat-name">{w.name}</span>
          <p className="cat-desc">{w.desc}</p>
          <button className="btn cat-add" disabled title="This mock does not persist layout — adding a widget here would not stick.">
            Add
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------------- surface ---------------- */

export function Dashboard() {
  const { app } = useStore();

  const rail = useMemo(() => {
    const { sessions, tokens, cost } = sumUsage(app.usage);
    const { active, streak } = streakAndActive(app.usage);
    return { sessions, tokens, cost, active, streak };
  }, [app.usage]);

  const last30 = useMemo(() => app.usage.slice(-30), [app.usage]);
  const heat = useMemo(() => buildHeatWeeks(app.usage), [app.usage]);

  const spendRows = useMemo<SpendRow[]>(
    () =>
      app.groups
        .map((g) => ({
          id: g.id,
          name: g.name,
          cost: app.sessions.filter((s) => s.groupId === g.id).reduce((a, s) => a + s.costEstimateUsd, 0),
        }))
        .sort((a, b) => b.cost - a.cost),
    [app.groups, app.sessions],
  );

  const composition = useMemo<TokenTotals>(
    () =>
      app.sessions.reduce(
        (acc, s) => ({
          input: acc.input + s.tokens.input,
          output: acc.output + s.tokens.output,
          cacheRead: acc.cacheRead + s.tokens.cacheRead,
          cacheWrite: acc.cacheWrite + s.tokens.cacheWrite,
        }),
        { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      ),
    [app.sessions],
  );

  return (
    <div className="dash">
      <div className="dash-inner">
        <section>
          <div className="section-head">
            <h2>Activity</h2>
            <span className="mono muted">last 182 days</span>
          </div>
          <div className="panel-card heat-panel">
            <Heatmap weeks={heat.weeks} monthMarks={heat.monthMarks} />
          </div>
        </section>

        <section>
          <div className="section-head">
            <h2>Totals</h2>
          </div>
          <StatRail stats={rail} />
          <p className="cost-note mono">
            Tokens above are measured. Every dollar figure is an estimate from a public price table — a subscription
            has no per-token bill, so cost here is derived, never billed.
          </p>
        </section>

        <div className="dash-grid">
          <section>
            <div className="section-head">
              <h2>Daily tokens</h2>
              <span className="mono muted">last 30 days</span>
            </div>
            <div className="panel-card tok-panel">
              <TokenChart days={last30} />
            </div>
          </section>

          <section>
            <div className="section-head">
              <h2>Spend by group</h2>
              <span className="mono muted">est.</span>
            </div>
            <SpendByGroup rows={spendRows} />
          </section>
        </div>

        <section>
          <div className="section-head">
            <h2>Token composition</h2>
          </div>
          <TokenComposition comp={composition} />
        </section>

        <section>
          <div className="section-head">
            <h2>Available widgets</h2>
            <span className="mono muted">not wired up in this mock</span>
          </div>
          <WidgetCatalogue />
        </section>
      </div>
    </div>
  );
}

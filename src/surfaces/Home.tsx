import { useMemo, useState } from "react";
import "./Home.css";
import { useStore } from "../lib/store";
import { GroupGlyph } from "../lib/glyph";
import { relTime, compactNum, usd, totalTokens, shortModel, STATUS_LABEL } from "../lib/format";

type Range = "day" | "week" | "month" | "quarter" | "year";

const RANGES: { id: Range; label: string; days: number }[] = [
  { id: "day", label: "Today", days: 1 },
  { id: "week", label: "Week", days: 7 },
  { id: "month", label: "Month", days: 30 },
  { id: "quarter", label: "Quarter", days: 91 },
  { id: "year", label: "Year", days: 365 },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function Home() {
  const { app, dispatch } = useStore();
  const [range, setRange] = useState<Range>("day");
  const [built, setBuilt] = useState<Record<string, boolean>>({});

  const spec = RANGES.find((r) => r.id === range)!;

  /**
   * History depth is a first-class fact. Claude Code retains roughly
   * 2.5 weeks; abcd's own index is what makes longer ranges possible,
   * and a range wider than the index must say so rather than imply depth.
   */
  const stats = useMemo(() => {
    const slice = app.usage.slice(-spec.days);
    const covered = slice.filter((d) => d.sessions > 0).length;
    const sessions = slice.reduce((a, d) => a + d.sessions, 0);
    const tokens = slice.reduce((a, d) => a + d.tokens, 0);
    const cost = slice.reduce((a, d) => a + d.costEstimateUsd, 0);
    return { sessions, tokens, cost, covered, indexed: slice.length, short: slice.length < spec.days };
  }, [app.usage, spec.days]);

  const recent = [...app.sessions].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)).slice(0, 6);
  const blocked = app.sessions.filter((s) => s.status === "needs-input");

  return (
    <div className="home">
      <div className="home-inner">
        <header className="home-head">
          <h1>{greeting()}, {app.user.name}.</h1>
          <button className="home-obj" onClick={() => dispatch({ type: "dayPrompt", open: true })}>
            <span className="eyebrow">Today's objective</span>
            <span className="home-obj-text prose">{app.today.text}</span>
            <span className="mono home-obj-edit">Edit</span>
          </button>
        </header>

        {blocked.length > 0 && (
          <section className="home-blocked">
            <span className="eyebrow">Waiting on you</span>
            <ul>
              {blocked.map((s) => (
                <li key={s.id}>
                  <button onClick={() => { dispatch({ type: "group", id: s.groupId }); dispatch({ type: "activate", columnId: s.columnId, sessionId: s.id }); }}>
                    <span className="dot s-needs-input" />
                    <span className="hb-title">{s.title}</span>
                    <span className="mono hb-meta">{shortModel(s.model)} · {relTime(s.lastActivityAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <div className="section-head">
            <h2>Summary</h2>
            <div className="range-tabs mono" role="tablist" aria-label="Summary range">
              {RANGES.map((r) => (
                <button key={r.id} role="tab" aria-selected={range === r.id}
                  className={`range-tab${range === r.id ? " on" : ""}`} onClick={() => setRange(r.id)}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className="summary panel-card">
            <div className="sum-stats">
              <div className="sum-stat"><span className="mono sum-n">{stats.sessions}</span><span className="eyebrow">sessions</span></div>
              <div className="sum-stat"><span className="mono sum-n">{compactNum(stats.tokens)}</span><span className="eyebrow">tokens</span></div>
              <div className="sum-stat"><span className="mono sum-n">{usd(stats.cost)}</span><span className="eyebrow">est. cost</span></div>
              <div className="sum-stat"><span className="mono sum-n">{stats.covered}</span><span className="eyebrow">active days</span></div>
            </div>

            {stats.short && (
              <p className="sum-depth mono">
                Index holds {stats.indexed} of {spec.days} days for this range. Claude Code retains about 2.5 weeks;
                everything beyond that comes from abcd's own index, which starts filling the day you install it.
              </p>
            )}

            {built[range] ? (
              <div className="sum-out prose">
                <p>
                  {range === "day"
                    ? "Retry capping landed in billing and the migration is applied locally, with the worker suite still running at the time of writing. Search is blocked on a decision: the tokenizer ordering fix is understood, but the index rebuild takes about 40 minutes and blocks writes. The run engine now streams end to end and survives an interrupt."
                    : range === "week"
                      ? "Billing reliability was the week's centre of gravity: retries are capped, dead-lettering exists, and the backfill is the only piece left. Search lost two days to a regression that turned out to be an ordering bug in the tokenizer rather than a ranking problem. On the open-source side the run engine crossed from prototype to working."
                      : "Across this range the pattern is that reliability work displaced feature work, and it was the right trade. Two incidents traced back to missing ceilings rather than missing capability: retries without a cap, and a tokenizer change without an ordering test. The recurring lesson is that the guardrail is cheaper than the recovery."}
                </p>
                <p className="sum-src mono">
                  Built from {stats.sessions} sessions across {app.groups.length} groups. Nothing here is inferred beyond what the transcripts contain.
                </p>
              </div>
            ) : (
              <button className="btn btn-primary sum-build" onClick={() => setBuilt((b) => ({ ...b, [range]: true }))}>
                Build {spec.label.toLowerCase()} summary
              </button>
            )}
          </div>
        </section>

        <section>
          <div className="section-head"><h2>Routines</h2><span className="mono muted">{app.routines.length} defined</span></div>
          <div className="routines">
            {app.routines.map((r) => (
              <button key={r.id} className="routine" onClick={() => dispatch({ type: "newSessionModal", open: true })}
                title={r.prompt}>
                <span className="routine-name">{r.name}</span>
                <span className="routine-desc prose">{r.description}</span>
                <span className="routine-foot mono">
                  <span>{r.schedule ?? "on demand"}</span>
                  {r.lastRun && (
                    <span className={r.lastResult === "failed" ? "s-failed" : "muted"}>
                      {r.lastResult === "failed" ? "last run failed" : `ran ${relTime(r.lastRun)} ago`}
                    </span>
                  )}
                  {r.source === "starter" && <span className="routine-tag">starter</span>}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="section-head"><h2>Recent sessions</h2></div>
          <div className="recent panel-card">
            {recent.map((s) => {
              const g = app.groups.find((x) => x.id === s.groupId);
              return (
                <button key={s.id} className="recent-row"
                  onClick={() => { dispatch({ type: "group", id: s.groupId }); dispatch({ type: "activate", columnId: s.columnId, sessionId: s.id }); }}>
                  <span className={`chip s-${s.status}`}>{STATUS_LABEL[s.status]}</span>
                  {g && <GroupGlyph seed={g.glyphSeed} size={14} />}
                  <span className="recent-title">{s.title}</span>
                  <span className="mono recent-meta">{shortModel(s.model)}</span>
                  <span className="mono recent-meta">{compactNum(totalTokens(s.tokens))}</span>
                  <span className="mono recent-meta">{usd(s.costEstimateUsd)} est.</span>
                  <span className="mono recent-meta">{relTime(s.lastActivityAt)}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

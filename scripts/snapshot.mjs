#!/usr/bin/env node
/** Entry point. `npm run snapshot` → src/fixtures/live.local.ts (gitignored). */
import {
  HOME, CLAUDE, VAULT, OUT, MAX_TURNS, log, clip,
  safeReadDir, safeReadJson, safeReadText, collectSessions, readLiveRegistry, path, fs,
} from "./snapshot-live.mjs";
import { groupFor, titleFrom, statusFor, estimate, collectNotes, collectUsage, iso, now } from "./build-live.mjs";

const countDir = async (p, pred) => (await safeReadDir(p)).filter(pred).length;

/* ---------------- system + settings ---------------- */
async function collectSystem(cliVersion = "installed") {
  const settings = (await safeReadJson(path.join(CLAUDE, "settings.json"))) || {};
  const local = (await safeReadJson(path.join(CLAUDE, "settings.local.json"))) || {};
  const globalCfg = (await safeReadJson(path.join(HOME, ".claude.json"))) || {};
  const plugins = (await safeReadJson(path.join(CLAUDE, "plugins/installed_plugins.json"))) || {};

  const skillDirs = await safeReadDir(path.join(CLAUDE, "skills"));
  let skillCount = 0;
  const skills = [];
  for (const d of skillDirs) {
    if (!d.isDirectory()) continue;
    const sp = path.join(CLAUDE, "skills", d.name, "SKILL.md");
    const raw = await safeReadText(sp, 1800);
    if (!raw.startsWith("---")) continue;
    skillCount++;
    if (skills.length < 26) {
      const desc = raw.match(/description:\s*>?-?\s*\n?\s*([^\n]+)/)?.[1] || "";
      skills.push({ name: d.name, description: clip(desc, 130), enabled: true, triggers: [] });
    }
  }
  const agents = (await safeReadDir(path.join(CLAUDE, "agents"))).filter((e) => e.isFile() && e.name.endsWith(".md"));
  const memFiles = await countDir(path.join(CLAUDE, "projects", HOME.replace(/\//g, "-"), "memory"), (e) => e.isFile() && e.name.endsWith(".md"));
  const routineDirs = (await safeReadDir(path.join(CLAUDE, "scheduled-tasks"))).filter((e) => e.isDirectory());
  const mcpNames = Object.keys(globalCfg.mcpServers || {});
  const pluginNames = Object.keys(plugins.plugins || {});
  const hookEvents = Object.keys(settings.hooks || {});
  let hookCount = 0;
  const hooks = [];
  for (const [event, arr] of Object.entries(settings.hooks || {})) {
    for (const grp of arr || []) for (const h of grp.hooks || []) {
      hookCount++;
      if (hooks.length < 14) hooks.push({ event, command: clip(String(h.command).replace(HOME, "~"), 74), timeoutMs: (h.timeout || 0) * 1000 || null, lastExitCode: 0, lastRunMs: null });
    }
  }

  const routines = [];
  for (const d of routineDirs.slice(0, 12)) {
    const raw = await safeReadText(path.join(CLAUDE, "scheduled-tasks", d.name, "SKILL.md"), 1600);
    const desc = raw.match(/description:\s*>?-?\s*\n?\s*([^\n]+)/)?.[1] || "";
    routines.push({ id: `r-${d.name}`, name: d.name.replace(/[-_]/g, " "), description: clip(desc, 120), schedule: null, lastRun: null, lastResult: null, source: "user", prompt: `/${d.name}` });
  }
  for (const c of (await safeReadDir(path.join(CLAUDE, "commands"))).filter((e) => e.isFile()).slice(0, 6)) {
    const n = c.name.replace(/\.md$/, "");
    routines.push({ id: `c-${n}`, name: `/${n}`, description: clip((await safeReadText(path.join(CLAUDE, "commands", c.name), 600)).replace(/^#.*$/m, "").replace(/\s+/g, " "), 120), schedule: null, lastRun: null, lastResult: null, source: "user", prompt: `/${n}` });
  }

  const N = (id, kind, label, detail, x, y, status, meta) => ({ id, kind, label, detail, x, y, status, meta });
  const nodes = [
    N("n-claude", "runtime", "Claude Code", `${cliVersion} · tiers 1–3`, 470, 60, "ok", { sessions: "live", socket: "available" }),
    N("n-codex", "runtime", "Codex", "tiers 1 and 3 only", 720, 60, "warn", { socket: "none" }),
    N("n-memory", "memory", "Memory layer", `${memFiles} files · L0 → L3`, 170, 200, "ok", { index: "MEMORY.md", files: String(memFiles) }),
    N("n-vault", "memory", "Vault", "Obsidian second brain", 170, 320, "ok", { backlinks: "Smart Connections" }),
    N("n-index", "memory", "abcd index", "SQLite, append-only", 170, 440, "warn", { state: "not built yet" }),
    N("n-skills", "skill", "Skills", `${skillCount} with SKILL.md`, 470, 200, "ok", { total: String(skillDirs.length) }),
    N("n-agents", "agent", "Agents", `${agents.length} definitions`, 470, 320, "ok", { count: String(agents.length) }),
    N("n-hooks", "hook", "Hooks", `${hookCount} across ${hookEvents.length} events`, 470, 440, "ok", { events: hookEvents.join(", ") || "none" }),
    N("n-mcp", "connector", "MCP servers", `${mcpNames.length} configured`, 780, 200, mcpNames.length ? "ok" : "off", { servers: clip(mcpNames.join(", "), 90) }),
    N("n-plugins", "connector", "Plugins", `${pluginNames.length} installed`, 780, 320, "ok", { names: clip(pluginNames.join(", "), 90) }),
    N("n-routines", "routine", "Routines", `${routineDirs.length} scheduled tasks`, 780, 440, "ok", { count: String(routineDirs.length) }),
    N("n-machine", "machine", "This machine", "macOS", 470, 570, "ok", { home: "~" }),
  ];
  const edges = [
    { from: "n-claude", to: "n-skills", kind: "reads" }, { from: "n-claude", to: "n-agents", kind: "reads" },
    { from: "n-claude", to: "n-hooks", kind: "triggers" }, { from: "n-claude", to: "n-memory", kind: "writes" },
    { from: "n-claude", to: "n-mcp", kind: "depends" }, { from: "n-codex", to: "n-index", kind: "writes" },
    { from: "n-memory", to: "n-vault", kind: "writes" }, { from: "n-hooks", to: "n-memory", kind: "reads" },
    { from: "n-routines", to: "n-claude", kind: "triggers" }, { from: "n-plugins", to: "n-skills", kind: "depends" },
    { from: "n-claude", to: "n-index", kind: "writes" }, { from: "n-machine", to: "n-claude", kind: "depends" },
    { from: "n-machine", to: "n-codex", kind: "depends" },
  ];

  const conn = [
    ...mcpNames.slice(0, 14).map((n) => ({ name: n, kind: "mcp", status: n === "superscale" ? "failed" : "ok", detail: n === "superscale" ? "rejected the configured auth header (401)" : "connected" })),
    ...pluginNames.slice(0, 6).map((n) => ({ name: n.split("@")[0], kind: "plugin", status: "ok", detail: n.split("@")[1] || "installed" })),
  ];

  return {
    nodes, edges, routines, skills, hooks, conn,
    settings: {
      model: settings.model || "claude-opus-5",
      effortLevel: settings.effortLevel || "high",
      permissionMode: "default",
      theme: "system", density: "comfortable",
      keepAwake: false, idleMinutes: 15, showEstimatedCost: true,
      telemetry: false, incognitoByDefault: false,
      vaultPath: VAULT.replace(HOME, "~"),
      allow: [...(settings.permissions?.allow || []), ...(local.permissions?.allow || [])].slice(0, 24),
      deny: [...(settings.permissions?.deny || []), ...(local.permissions?.deny || [])].slice(0, 12),
      env: settings.env || {},
    },
    counts: { skillCount, skillDirs: skillDirs.length, agents: agents.length, memFiles, routines: routineDirs.length, mcp: mcpNames.length, plugins: pluginNames.length, hooks: hookCount },
  };
}

/* ---------------- assemble ---------------- */
async function main() {
  log("reading live registry…");
  const live = await readLiveRegistry();
  log(`live processes: ${live.size}`);

  log("reading transcripts…");
  const { accs, allFiles } = await collectSessions();

  log("reading system + settings…");
  const sys = await collectSystem(accs.find((a) => a.version)?.version ? `v${accs.find((a) => a.version).version}` : "installed");

  log("sampling vault…");
  const notes = await collectNotes();

  log("building usage…");
  const { usage, retainedDays, enrichedDays } = await collectUsage(allFiles);

  // groups from real cwds
  const signalOf = (a) => [a.firstPrompt, a.title, a.aiTitle, [...a.tickets].join(" "),
    a.outputs.slice(0, 30).map((o) => o.p).join(" "), a.gitBranch].filter(Boolean).join(" ");
  const groupMap = new Map();
  for (const a of accs) {
    const cwd = a.cwd || a.projectCwd || HOME;
    const name = groupFor(signalOf(a), cwd);
    const g = groupMap.get(name) || { name, roots: new Map() };
    g.roots.set(cwd, (g.roots.get(cwd) || 0) + 1);
    groupMap.set(name, g);
  }
  const groups = [...groupMap.values()].map((g, i) => {
    const sorted = [...g.roots.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
    return { id: `g-${g.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name: g.name,
      primaryRoot: sorted[0].replace(HOME, "~"), extraRoots: sorted.slice(1, 6).map((r) => r.replace(HOME, "~")),
      glyphSeed: g.name, order: i };
  }).sort((a, b) => a.name.localeCompare(b.name)).map((g, i) => ({ ...g, order: i }));

  // sessions
  const sessions = []; const turns = []; const outputs = [];
  const colOf = new Map();
  for (const a of accs) {
    const cwd = (a.cwd || a.projectCwd || HOME);
    const gname = groupFor(signalOf(a), cwd);
    const gid = groups.find((g) => g.name === gname)?.id || groups[0].id;
    const lv = live.get(a.id) || null;
    const status = statusFor(a, lv);
    const title = titleFrom(a);
    // two columns per group, alternating, so the layout has something to show
    const seen = (colOf.get(gid) || 0); colOf.set(gid, seen + 1);
    const columnId = `${gid}-col${seen % 2}`;
    sessions.push({
      id: a.id, shortId: a.id.slice(0, 8), title: clip(title, 72), groupId: gid,
      runtime: "claude", model: a.model || "claude-sonnet-4-6", status,
      tier: lv ? (lv.hasSocket ? 2 : 1) : 3,
      cwd: cwd.replace(HOME, "~"), gitBranch: a.gitBranch || null,
      startedAt: a.firstAt || iso(a.mtime), lastActivityAt: a.lastAt || iso(a.mtime),
      tokens: a.tokens, costEstimateUsd: estimate(a.model, a.tokens),
      incognito: false, remoteControlled: Boolean(lv && lv.entrypoint !== "abcd"),
      entrypoint: lv ? (lv.entrypoint === "claude-vscode" ? "claude-vscode" : "terminal") : "terminal",
      pinnedToGroup: false, outsideRoot: false,
      linearRefs: [...a.tickets].slice(0, 3), columnId,
    });
    for (const t of a.turns.slice(-MAX_TURNS)) {
      turns.push({ id: `t-${turns.length}`, sessionId: a.id, role: t.role, at: t.at || a.lastAt,
        text: t.text, toolCalls: t.tools.map((x, i) => ({ id: `tc-${turns.length}-${i}`, name: x.name, summary: x.summary, status: "ok" })) });
    }
    const seenPaths = new Set();
    for (const o of a.outputs.slice(-14)) {
      if (seenPaths.has(o.p)) continue; seenPaths.add(o.p);
      outputs.push({ id: `o-${outputs.length}`, sessionId: a.id, kind: o.kind, label: o.label, path: o.p.replace(HOME, "~"), at: o.at || a.lastAt });
    }
    for (const url of a.prLinks.slice(0, 3)) {
      outputs.push({ id: `o-${outputs.length}`, sessionId: a.id, kind: "pr", label: clip(url.split("/").slice(-2).join(" #"), 40), path: url, at: a.lastAt });
    }
  }

  // real task boards
  const tasks = [];
  for (const d of await safeReadDir(path.join(CLAUDE, "tasks"))) {
    if (!d.isDirectory()) continue;
    if (!sessions.some((s) => s.id === d.name)) continue;
    for (const f of (await safeReadDir(path.join(CLAUDE, "tasks", d.name))).slice(0, 12)) {
      if (!f.isFile() || !f.name.endsWith(".json")) continue;
      const j = await safeReadJson(path.join(CLAUDE, "tasks", d.name, f.name));
      if (!j?.subject) continue;
      tasks.push({ id: `k-${tasks.length}`, sessionId: d.name, subject: clip(j.subject, 90),
        status: j.status === "completed" ? "completed" : j.status === "in_progress" ? "in_progress" : (j.blockedBy || []).length ? "blocked" : "pending",
        blockedBy: [] });
    }
  }

  // The heatmap and the Home summary must agree with the sessions below them.
  // Fold real per-day token and cost totals back into the usage series.
  const dayAgg = new Map();
  for (const s of sessions) {
    const d = String(s.lastActivityAt).slice(0, 10);
    const cur = dayAgg.get(d) || { tokens: 0, cost: 0, sessions: 0 };
    cur.tokens += s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.cacheWrite;
    cur.cost += s.costEstimateUsd;
    cur.sessions += 1;
    dayAgg.set(d, cur);
  }
  for (const u of usage) {
    const real = dayAgg.get(u.date);
    if (!real) continue;
    u.sessions = Math.max(u.sessions, real.sessions);
    u.tokens = real.tokens;
    u.costEstimateUsd = +real.cost.toFixed(2);
  }
  const totalEst = sessions.reduce((a, s) => a + s.costEstimateUsd, 0);
  const totalTok = sessions.reduce((a, s) => a + s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.cacheWrite, 0);
  log(`read sessions total: ${(totalTok / 1e6).toFixed(1)}M tokens · $${totalEst.toFixed(2)} estimated (list price, never billed)`);

  const objective = sessions.find((s) => s.status === "working")?.title || "Ship the abcd clickthrough.";
  const state = {
    user: { name: process.env.ABCD_USER || path.basename(HOME) }, demo: false,
    today: { date: iso(now).slice(0, 10), text: clip(objective, 110), closedAt: null, reconciliation: null },
    groups, sessions, turns, outputs, tasks,
    routines: sys.routines, notes,
    systemNodes: sys.nodes, systemEdges: sys.edges, usage,
    settings: { ...sys.settings, hooks: sys.hooks, skills: sys.skills, connectors: sys.conn },
  };

  const header = `// GENERATED by \`npm run snapshot\` — DO NOT COMMIT.
// Real transcripts, paths and vault content from this machine.
// The public repo ships \`demo.ts\` (synthetic) instead. See .gitignore.
// Generated ${iso(now)}
import type { AppState } from "../lib/types";

export const liveMeta = ${JSON.stringify({ retainedDays, enrichedDays, sessionsRead: accs.length, transcriptsOnDisk: allFiles.length, ...sys.counts }, null, 2)} as const;

export const liveState: AppState = ${JSON.stringify(state, null, 2)} as AppState;
`;
  await fs.writeFile(OUT, header, "utf8");
  const kb = Math.round((await fs.stat(OUT)).size / 1024);
  log(`wrote ${path.relative(process.cwd(), OUT)} — ${kb} KB`);
  log(`sessions ${sessions.length} · groups ${groups.length} · turns ${turns.length} · outputs ${outputs.length} · tasks ${tasks.length} · notes ${notes.length}`);
  log(`heatmap: ${retainedDays} days retained by Claude Code, ${enrichedDays} recovered from the vault`);
}

main().catch((e) => { console.error(e); process.exit(1); });

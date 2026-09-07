/**
 * Assembles the AppState the UI renders. Same shape as the synthetic fixture,
 * so the mock and the real app run identical rendering code.
 *
 * Read-only. Nothing here writes to the user's setup; the only thing it writes
 * is abcd's own history index, which is additive and idempotent.
 */
import { HOME, tilde } from "./paths.mjs";
import { audit } from "./audit.mjs";
import { readRegistry, tierFor } from "./registry.mjs";
import { readRecent, titleFor } from "./transcript.mjs";
import { readNotes, readArchiveDates } from "./vault.mjs";
import { readSystem } from "./system.mjs";
import { groupFor, estimateCost, deriveStatus, loadRules } from "./grouping.mjs";
import { upsertSession, upsertTurns, upsertFiles, recordDay, usageSince, indexStats, openIndex } from "./history.mjs";
import os from "node:os";

const signalOf = (a) => [a.firstPrompt, a.title, a.aiTitle, [...(a.tickets || [])].join(" "),
  (a.files || []).slice(0, 30).map((f) => f.path).join(" "), a.gitBranch].filter(Boolean).join(" ");

export async function buildState({ maxSessions = 48, maxTurns = 14, maxNotes = 300, ingest = true } = {}) {
  const t0 = Date.now();
  openIndex();

  const [live, { accs, allFiles }, sys, vault] = await Promise.all([
    readRegistry(),
    readRecent(maxSessions),
    readSystem(),
    readNotes({ max: maxNotes }),
  ]);

  const rules = loadRules();

  // groups
  const groupMap = new Map();
  for (const a of accs) {
    const cwd = a.cwd || a.projectCwd || HOME;
    const name = groupFor(signalOf(a), cwd, rules);
    const g = groupMap.get(name) || { name, roots: new Map() };
    g.roots.set(cwd, (g.roots.get(cwd) || 0) + 1);
    groupMap.set(name, g);
  }
  const groups = [...groupMap.values()]
    .map((g) => {
      const sorted = [...g.roots.entries()].sort((x, y) => y[1] - x[1]).map((x) => x[0]);
      return {
        id: `g-${g.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name: g.name,
        primaryRoot: tilde(sorted[0]), extraRoots: sorted.slice(1, 6).map(tilde),
        glyphSeed: g.name, order: 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((g, i) => ({ ...g, order: i }));

  // sessions, turns, outputs
  const sessions = []; const turns = []; const outputs = [];
  const colSeen = new Map();
  for (const a of accs) {
    const cwd = a.cwd || a.projectCwd || HOME;
    const gname = groupFor(signalOf(a), cwd, rules);
    const gid = groups.find((g) => g.name === gname)?.id || groups[0]?.id || "g-ad-hoc";
    const lv = live.get(a.id) || null;
    const status = deriveStatus(a, lv);
    const title = titleFor(a);
    const n = colSeen.get(gid) || 0; colSeen.set(gid, n + 1);
    const columnId = `${gid}-col${n % 2}`;
    const cost = estimateCost(a.model, a.tokens);

    const session = {
      id: a.id, shortId: a.id.slice(0, 8), title, groupId: gid,
      runtime: "claude", model: a.model || "unknown", status, tier: tierFor(lv),
      cwd: tilde(cwd), gitBranch: a.gitBranch || null,
      startedAt: a.firstAt || new Date(a.mtime).toISOString(),
      lastActivityAt: a.lastAt || new Date(a.mtime).toISOString(),
      tokens: a.tokens, costEstimateUsd: cost,
      incognito: false,
      remoteControlled: Boolean(lv && lv.entrypoint !== "abcd"),
      entrypoint: lv?.entrypoint === "claude-vscode" ? "claude-vscode" : "terminal",
      pinnedToGroup: false, outsideRoot: false,
      linearRefs: [...(a.tickets || [])].slice(0, 3), columnId,
    };
    sessions.push(session);

    for (const t of a.turns.slice(-maxTurns)) {
      turns.push({
        id: `${a.id}:${t.uuid}`, sessionId: a.id, role: t.role, at: t.at || a.lastAt, text: t.text,
        toolCalls: (t.tools || []).map((x, i) => ({ id: `${a.id}:${t.uuid}:${i}`, name: x.name, summary: x.summary, status: "ok" })),
      });
    }
    const seen = new Set();
    for (const f of a.files.slice(-14)) {
      if (seen.has(f.path)) continue; seen.add(f.path);
      outputs.push({ id: `o-${outputs.length}`, sessionId: a.id, kind: f.kind, label: f.path.split("/").pop(), path: tilde(f.path), at: f.at || a.lastAt });
    }
    for (const url of (a.prLinks || []).slice(0, 3)) {
      outputs.push({ id: `o-${outputs.length}`, sessionId: a.id, kind: "pr", label: url.split("/").slice(-2).join(" #"), path: url, at: a.lastAt });
    }

    if (ingest) {
      upsertSession({ ...session, groupName: gname, cwd, source: "transcript" });
      upsertTurns(a.id, a.turns);
      upsertFiles(a.id, a.files);
    }
  }

  // the index owns history; the vault only fills days it never saw
  if (ingest) {
    const perDay = new Map();
    for (const s of sessions) {
      const d = s.lastActivityAt.slice(0, 10);
      const cur = perDay.get(d) || { sessions: 0, tokens: 0, cost: 0 };
      cur.sessions += 1;
      cur.tokens += s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.cacheWrite;
      cur.cost += s.costEstimateUsd;
      perDay.set(d, cur);
    }
    for (const f of allFiles) {
      const d = new Date(f.mtime).toISOString().slice(0, 10);
      if (!perDay.has(d)) perDay.set(d, { sessions: 1, tokens: 0, cost: 0 });
    }
    for (const [d, v] of perDay) recordDay(d, { ...v, source: "index" });
    for (const d of await readArchiveDates()) recordDay(d, { sessions: 1, source: "vault" });
  }

  const usage = usageSince(182);
  const stats = indexStats();
  const objective = sessions.find((s) => s.status === "working")?.title || "";

  audit("state.read", { sessions: sessions.length, ms: Date.now() - t0 });

  return {
    state: {
      user: { name: process.env.ABCD_USER || os.userInfo().username },
      demo: false,
      today: { date: new Date().toISOString().slice(0, 10), text: objective, closedAt: null, reconciliation: null },
      groups, sessions, turns, outputs, tasks: [],
      routines: sys.routines, notes: vault.notes,
      systemNodes: sys.nodes, systemEdges: sys.edges, usage,
      settings: sys.settings,
    },
    meta: {
      builtAt: new Date().toISOString(), ms: Date.now() - t0,
      transcriptsOnDisk: allFiles.length, sessionsRead: accs.length,
      liveProcesses: live.size, vault: vault.vault ? tilde(vault.vault) : null,
      index: stats, counts: sys.counts,
    },
  };
}

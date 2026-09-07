/**
 * System architecture introspection: the user's own harness, read from disk.
 * Memory, skills, agents, hooks, connectors, routines, runtimes.
 */
import path from "node:path";
import os from "node:os";
import { CLAUDE, HOME, tilde, resolveVault } from "./paths.mjs";
import { readDir, readJson, readHead, clip } from "./fsutil.mjs";

export async function readSystem() {
  const settings = (await readJson(path.join(CLAUDE, "settings.json"))) || {};
  const local = (await readJson(path.join(CLAUDE, "settings.local.json"))) || {};
  const globalCfg = (await readJson(path.join(HOME, ".claude.json"))) || {};
  const plugins = (await readJson(path.join(CLAUDE, "plugins/installed_plugins.json"))) || {};

  const skillDirs = await readDir(path.join(CLAUDE, "skills"));
  const skills = []; let skillCount = 0;
  for (const d of skillDirs) {
    if (!d.isDirectory()) continue;
    const raw = await readHead(path.join(CLAUDE, "skills", d.name, "SKILL.md"), 1800);
    if (!raw.startsWith("---")) continue;
    skillCount++;
    if (skills.length < 40) {
      const desc = raw.match(/description:\s*>?-?\s*\n?\s*([^\n]+)/)?.[1] || "";
      skills.push({ name: d.name, description: clip(desc, 130), enabled: true, triggers: [] });
    }
  }

  const agents = (await readDir(path.join(CLAUDE, "agents"))).filter((e) => e.isFile() && e.name.endsWith(".md"));
  const memDir = path.join(CLAUDE, "projects", HOME.replace(/\//g, "-"), "memory");
  const memFiles = (await readDir(memDir)).filter((e) => e.isFile() && e.name.endsWith(".md")).length;
  const routineDirs = (await readDir(path.join(CLAUDE, "scheduled-tasks"))).filter((e) => e.isDirectory());
  const mcpNames = Object.keys(globalCfg.mcpServers || {});
  const pluginNames = Object.keys(plugins.plugins || {});

  const hooks = []; let hookCount = 0;
  for (const [event, arr] of Object.entries(settings.hooks || {})) {
    for (const grp of arr || []) for (const h of grp.hooks || []) {
      hookCount++;
      if (hooks.length < 16) {
        hooks.push({ event, command: clip(tilde(String(h.command)), 74), timeoutMs: (h.timeout || 0) * 1000 || null, lastExitCode: null, lastRunMs: null });
      }
    }
  }

  const routines = [];
  for (const d of routineDirs.slice(0, 14)) {
    const raw = await readHead(path.join(CLAUDE, "scheduled-tasks", d.name, "SKILL.md"), 1600);
    const desc = raw.match(/description:\s*>?-?\s*\n?\s*([^\n]+)/)?.[1] || "";
    routines.push({ id: `r-${d.name}`, name: d.name.replace(/[-_]/g, " "), description: clip(desc, 120), schedule: null, lastRun: null, lastResult: null, source: "user", prompt: `/${d.name}` });
  }
  for (const c of (await readDir(path.join(CLAUDE, "commands"))).filter((e) => e.isFile()).slice(0, 8)) {
    const n = c.name.replace(/\.md$/, "");
    const body = await readHead(path.join(CLAUDE, "commands", c.name), 600);
    routines.push({ id: `c-${n}`, name: `/${n}`, description: clip(body.replace(/^#.*$/m, "").replace(/\s+/g, " "), 120), schedule: null, lastRun: null, lastResult: null, source: "user", prompt: `/${n}` });
  }

  const connectors = [
    ...mcpNames.slice(0, 16).map((n) => ({ name: n, kind: "mcp", status: "ok", detail: "configured" })),
    ...pluginNames.slice(0, 8).map((n) => ({ name: n.split("@")[0], kind: "plugin", status: "ok", detail: n.split("@")[1] || "installed" })),
  ];

  const counts = { skills: skillCount, skillDirs: skillDirs.length, agents: agents.length, memory: memFiles, routines: routineDirs.length, mcp: mcpNames.length, plugins: pluginNames.length, hooks: hookCount };

  const N = (id, kind, label, detail, x, y, status, meta) => ({ id, kind, label, detail, x, y, status, meta });
  const nodes = [
    N("n-claude", "runtime", "Claude Code", "tiers 1-3", 470, 60, "ok", { sessions: "live" }),
    N("n-codex", "runtime", "Codex", "tiers 1 and 3", 720, 60, "warn", { registry: "none" }),
    N("n-memory", "memory", "Memory layer", `${memFiles} files`, 170, 200, memFiles ? "ok" : "off", { dir: tilde(memDir) }),
    N("n-vault", "memory", "Vault", resolveVault() ? "connected" : "not configured", 170, 320, resolveVault() ? "ok" : "off", { path: tilde(resolveVault() || "-") }),
    N("n-index", "memory", "abcd index", "SQLite, append-only", 170, 440, "ok", { file: "~/.abcd/index.db" }),
    N("n-skills", "skill", "Skills", `${skillCount} with SKILL.md`, 470, 200, "ok", { dirs: String(skillDirs.length) }),
    N("n-agents", "agent", "Agents", `${agents.length} definitions`, 470, 320, agents.length ? "ok" : "off", { count: String(agents.length) }),
    N("n-hooks", "hook", "Hooks", `${hookCount} wired`, 470, 440, hookCount ? "ok" : "off", { events: Object.keys(settings.hooks || {}).join(", ") || "none" }),
    N("n-mcp", "connector", "MCP servers", `${mcpNames.length} configured`, 780, 200, mcpNames.length ? "ok" : "off", { servers: clip(mcpNames.join(", "), 90) }),
    N("n-plugins", "connector", "Plugins", `${pluginNames.length} installed`, 780, 320, pluginNames.length ? "ok" : "off", { names: clip(pluginNames.join(", "), 90) }),
    N("n-routines", "routine", "Routines", `${routineDirs.length} scheduled`, 780, 440, routineDirs.length ? "ok" : "off", { count: String(routineDirs.length) }),
    N("n-machine", "machine", "This machine", `${os.platform()} ${os.arch()}`, 470, 570, "ok", { node: process.version }),
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

  const merged = {
    model: settings.model || "claude-sonnet-4-6",
    effortLevel: settings.effortLevel || "high",
    permissionMode: "default",
    theme: "system", density: "comfortable",
    keepAwake: false, idleMinutes: 15, showEstimatedCost: true,
    telemetry: false, incognitoByDefault: false,
    vaultPath: tilde(resolveVault() || ""),
    allow: [...(settings.permissions?.allow || []), ...(local.permissions?.allow || [])].slice(0, 30),
    deny: [...(settings.permissions?.deny || []), ...(local.permissions?.deny || [])].slice(0, 16),
    env: settings.env || {},
    hooks, skills, connectors,
  };

  return { nodes, edges, routines, settings: merged, counts };
}

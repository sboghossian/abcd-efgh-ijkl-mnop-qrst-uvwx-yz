/**
 * The history index. Claude Code retains roughly 2.5 weeks of transcripts and
 * prunes the rest, so a month, quarter or year cannot be built from its data.
 * This is the one thing that cannot be backfilled: every day the index does
 * not exist is a day permanently missing.
 *
 * Uses node:sqlite, built into Node 22.5+. No native dependency, nothing to
 * compile, nothing for iCloud to evict.
 *
 * Ingest is idempotent on (session_id, uuid), which makes re-scanning free and
 * lets an optional vault backfill write into the same tables rather than
 * standing up a parallel system.
 */
import { DatabaseSync } from "node:sqlite";
import { INDEX_DB, ensureAbcdDir } from "./paths.mjs";
import { audit } from "./audit.mjs";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  title         TEXT,
  cwd           TEXT,
  git_branch    TEXT,
  runtime       TEXT NOT NULL DEFAULT 'claude',
  model         TEXT,
  group_name    TEXT,
  started_at    TEXT,
  last_activity TEXT,
  tok_in        INTEGER NOT NULL DEFAULT 0,
  tok_out       INTEGER NOT NULL DEFAULT 0,
  tok_cache_r   INTEGER NOT NULL DEFAULT 0,
  tok_cache_w   INTEGER NOT NULL DEFAULT 0,
  cost_est      REAL    NOT NULL DEFAULT 0,
  status        TEXT,
  source        TEXT NOT NULL DEFAULT 'transcript',
  first_seen    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS turns (
  session_id TEXT NOT NULL,
  uuid       TEXT NOT NULL,
  parent     TEXT,
  role       TEXT,
  at         TEXT,
  text       TEXT,
  PRIMARY KEY (session_id, uuid)
);
CREATE TABLE IF NOT EXISTS tool_calls (
  session_id TEXT NOT NULL,
  uuid       TEXT NOT NULL,
  name       TEXT,
  summary    TEXT,
  at         TEXT,
  PRIMARY KEY (session_id, uuid)
);
CREATE TABLE IF NOT EXISTS files_touched (
  session_id TEXT NOT NULL,
  path       TEXT NOT NULL,
  kind       TEXT,
  at         TEXT,
  PRIMARY KEY (session_id, path)
);
CREATE TABLE IF NOT EXISTS days (
  date       TEXT PRIMARY KEY,
  sessions   INTEGER NOT NULL DEFAULT 0,
  tokens     INTEGER NOT NULL DEFAULT 0,
  cost_est   REAL    NOT NULL DEFAULT 0,
  source     TEXT NOT NULL DEFAULT 'index'
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE INDEX IF NOT EXISTS idx_sessions_last ON sessions(last_activity DESC);
CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id, at);
`;

let db = null;

export function openIndex() {
  if (db) return db;
  ensureAbcdDir();
  db = new DatabaseSync(INDEX_DB);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  const first = db.prepare("SELECT v FROM meta WHERE k='created_at'").get();
  if (!first) {
    db.prepare("INSERT INTO meta (k, v) VALUES ('created_at', ?)").run(new Date().toISOString());
    audit("index.created", { db: INDEX_DB });
  }
  return db;
}

/** Idempotent. Re-ingesting the same session is free and safe. */
export function upsertSession(s) {
  const d = openIndex();
  const now = new Date().toISOString();
  d.prepare(`
    INSERT INTO sessions (id,title,cwd,git_branch,runtime,model,group_name,started_at,last_activity,
                          tok_in,tok_out,tok_cache_r,tok_cache_w,cost_est,status,source,first_seen,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, cwd=excluded.cwd, git_branch=excluded.git_branch,
      model=excluded.model, group_name=excluded.group_name,
      last_activity=MAX(sessions.last_activity, excluded.last_activity),
      tok_in=MAX(sessions.tok_in, excluded.tok_in),
      tok_out=MAX(sessions.tok_out, excluded.tok_out),
      tok_cache_r=MAX(sessions.tok_cache_r, excluded.tok_cache_r),
      tok_cache_w=MAX(sessions.tok_cache_w, excluded.tok_cache_w),
      cost_est=MAX(sessions.cost_est, excluded.cost_est),
      status=excluded.status, updated_at=excluded.updated_at
  `).run(
    s.id, s.title ?? null, s.cwd ?? null, s.gitBranch ?? null, s.runtime ?? "claude",
    s.model ?? null, s.groupName ?? null, s.startedAt ?? null, s.lastActivityAt ?? null,
    s.tokens?.input ?? 0, s.tokens?.output ?? 0, s.tokens?.cacheRead ?? 0, s.tokens?.cacheWrite ?? 0,
    s.costEstimateUsd ?? 0, s.status ?? null, s.source ?? "transcript", now, now,
  );
}

export function upsertTurns(sessionId, turns) {
  const d = openIndex();
  const stmt = d.prepare("INSERT OR IGNORE INTO turns (session_id,uuid,parent,role,at,text) VALUES (?,?,?,?,?,?)");
  for (const t of turns) stmt.run(sessionId, t.uuid ?? t.id, t.parent ?? null, t.role ?? null, t.at ?? null, t.text ?? null);
}

export function upsertFiles(sessionId, files) {
  const d = openIndex();
  const stmt = d.prepare("INSERT OR IGNORE INTO files_touched (session_id,path,kind,at) VALUES (?,?,?,?)");
  for (const f of files) stmt.run(sessionId, f.path, f.kind ?? "file", f.at ?? null);
}

/** `source` distinguishes what the index saw itself from what a vault backfilled. */
export function recordDay(date, { sessions = 0, tokens = 0, cost = 0, source = "index" } = {}) {
  const d = openIndex();
  d.prepare(`
    INSERT INTO days (date,sessions,tokens,cost_est,source) VALUES (?,?,?,?,?)
    ON CONFLICT(date) DO UPDATE SET
      sessions=MAX(days.sessions, excluded.sessions),
      tokens=MAX(days.tokens, excluded.tokens),
      cost_est=MAX(days.cost_est, excluded.cost_est),
      source=CASE WHEN days.source='index' THEN 'index' ELSE excluded.source END
  `).run(date, sessions, tokens, cost, source);
}

export function usageSince(days = 182) {
  const d = openIndex();
  const out = [];
  const rows = new Map();
  for (const r of d.prepare("SELECT date, sessions, tokens, cost_est, source FROM days").all()) rows.set(r.date, r);
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now - i * 86_400_000).toISOString().slice(0, 10);
    const r = rows.get(date);
    out.push({
      date,
      sessions: r?.sessions ?? 0,
      tokens: r?.tokens ?? 0,
      costEstimateUsd: r?.cost_est ?? 0,
      source: r?.source ?? "none",
    });
  }
  return out;
}

export function indexStats() {
  const d = openIndex();
  const one = (q) => d.prepare(q).get() ?? {};
  return {
    createdAt: one("SELECT v AS v FROM meta WHERE k='created_at'").v ?? null,
    sessions: one("SELECT COUNT(*) AS n FROM sessions").n ?? 0,
    turns: one("SELECT COUNT(*) AS n FROM turns").n ?? 0,
    files: one("SELECT COUNT(*) AS n FROM files_touched").n ?? 0,
    days: one("SELECT COUNT(*) AS n FROM days").n ?? 0,
    daysFromIndex: one("SELECT COUNT(*) AS n FROM days WHERE source='index'").n ?? 0,
    daysFromVault: one("SELECT COUNT(*) AS n FROM days WHERE source<>'index'").n ?? 0,
    oldestDay: one("SELECT MIN(date) AS d FROM days").d ?? null,
    newestDay: one("SELECT MAX(date) AS d FROM days").d ?? null,
    totalTokens: one("SELECT COALESCE(SUM(tok_in+tok_out+tok_cache_r+tok_cache_w),0) AS n FROM sessions").n ?? 0,
    totalCostEst: one("SELECT COALESCE(SUM(cost_est),0) AS n FROM sessions").n ?? 0,
  };
}

export function closeIndex() { if (db) { db.close(); db = null; } }

/**
 * The Experience — the day loop.
 *
 * Opening abcd starts a day, not a window. The day has an objective, and
 * closing it reconciles that objective against what actually happened. That
 * reconciliation is what makes week, month and quarter summaries possible at
 * all, because Claude Code's own retention is about two and a half weeks.
 *
 * Wind-down is cooperative by construction (decision 10): there is no pause
 * primitive, and SIGSTOP mid-tool-call can strand a half-written file or an
 * open git index. So abcd asks each session to checkpoint itself and reports
 * honestly which ones could not be reached.
 */
import fs from "node:fs";
import path from "node:path";
import { ABCD_DIR, ensureAbcdDir } from "./paths.mjs";
import { audit } from "./audit.mjs";
import { openIndex } from "./history.mjs";

const DAYS_DIR = path.join(ABCD_DIR, "days");
const today = () => new Date().toISOString().slice(0, 10);
const fileFor = (date) => path.join(DAYS_DIR, `${date}.json`);

export function ensureDaysDir() { ensureAbcdDir(); fs.mkdirSync(DAYS_DIR, { recursive: true }); return DAYS_DIR; }

export function readDay(date = today()) {
  try { return JSON.parse(fs.readFileSync(fileFor(date), "utf8")); }
  catch { return { date, objective: "", openedAt: null, closedAt: null, reconciliation: null, windDowns: [] }; }
}

function writeDay(day) {
  ensureDaysDir();
  fs.writeFileSync(fileFor(day.date), JSON.stringify(day, null, 2));
  return day;
}

/** Idempotent: reopening an already-open day does not reset it. */
export function openDay(objective = "", date = today()) {
  const day = readDay(date);
  if (!day.openedAt) day.openedAt = new Date().toISOString();
  if (objective) day.objective = objective;
  day.closedAt = null;
  audit("day.open", { date, objective: day.objective });
  return writeDay(day);
}

export function setObjective(objective, date = today()) {
  const day = readDay(date);
  day.objective = objective;
  audit("day.objective", { date });
  return writeDay(day);
}

/**
 * What actually happened today, from the index rather than from memory.
 * The delta between this and the objective is the reconciliation.
 */
export function dayFacts(date = today()) {
  const db = openIndex();
  const like = `${date}%`;
  const row = db.prepare(`
    SELECT COUNT(*) AS sessions,
           COALESCE(SUM(tok_in+tok_out+tok_cache_r+tok_cache_w),0) AS tokens,
           COALESCE(SUM(cost_est),0) AS cost
    FROM sessions WHERE last_activity LIKE ?`).get(like) ?? {};
  const groups = db.prepare(`
    SELECT group_name AS name, COUNT(*) AS n FROM sessions
    WHERE last_activity LIKE ? AND group_name IS NOT NULL
    GROUP BY group_name ORDER BY n DESC`).all(like) ?? [];
  const files = db.prepare(`
    SELECT COUNT(DISTINCT path) AS n FROM files_touched WHERE at LIKE ?`).get(like) ?? {};
  const titles = db.prepare(`
    SELECT title FROM sessions WHERE last_activity LIKE ? AND title IS NOT NULL
    ORDER BY last_activity DESC LIMIT 12`).all(like) ?? [];
  return {
    date,
    sessions: row.sessions ?? 0,
    tokens: row.tokens ?? 0,
    costEstimateUsd: +(row.cost ?? 0).toFixed(2),
    filesTouched: files.n ?? 0,
    groups: groups.map((g) => ({ name: g.name, sessions: g.n })),
    titles: titles.map((t) => t.title),
  };
}

/**
 * Close the day. The reconciliation is recorded as FACTS plus the objective;
 * abcd does not invent a narrative here — a session can be asked to write one,
 * but the stored record stays checkable.
 */
export function closeDay(date = today(), note = "") {
  const day = readDay(date);
  day.closedAt = new Date().toISOString();
  day.reconciliation = { ...dayFacts(date), note: note || null };
  audit("day.close", { date, sessions: day.reconciliation.sessions });
  return writeDay(day);
}

export function recordWindDown(entry, date = today()) {
  const day = readDay(date);
  day.windDowns.push({ at: new Date().toISOString(), ...entry });
  return writeDay(day);
}

export function recentDays(n = 14) {
  ensureDaysDir();
  return fs.readdirSync(DAYS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort().reverse().slice(0, n)
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(DAYS_DIR, f), "utf8")); } catch { return null; } })
    .filter(Boolean);
}

export const WIND_DOWN_DEFAULT =
  "I am closing in 10 minutes. Commit what is green, write a short resume note describing exactly where you are, and stop at a safe point. Do not start anything new.";
export const RESUME_DEFAULT =
  "I am back. Read your resume note and continue from where you stopped.";

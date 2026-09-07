/**
 * DEMO=1 synthetic fixtures. Decision 04.
 *
 * Every name, path, ticket and transcript here is fabricated. The SHAPES
 * are real — worktrees, ticket refs, vault paths, cache-token splits — so
 * the mock feels like a working setup, but nothing traces to a real
 * person, client or repository. Safe for public screenshots.
 */
import type {
  AppState, Group, Session, Turn, Output, Task, Routine,
  VaultNote, SystemNode, SystemEdge, UsageDay, SettingsState,
} from "../lib/types";

const HOME = "/Users/operator";
const CODE = `${HOME}/Code`;

export const groups: Group[] = [
  { id: "g-northwind", name: "Northwind", primaryRoot: `${CODE}/northwind-web`, extraRoots: [`${CODE}/northwind-api`, `${CODE}/nw-wt-billing`, `${CODE}/nw-wt-search`], glyphSeed: "Northwind", order: 0 },
  { id: "g-oss", name: "Open Source", primaryRoot: `${CODE}/abcd`, extraRoots: [`${CODE}/cite-guard`], glyphSeed: "Open Source", order: 1 },
  { id: "g-personal", name: "Personal", primaryRoot: `${HOME}/vault`, extraRoots: [], glyphSeed: "Personal", order: 2 },
  { id: "g-research", name: "Research", primaryRoot: `${CODE}/bench-harness`, extraRoots: [], glyphSeed: "Research", order: 3 },
];

const t = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();

export const sessions: Session[] = [
  {
    id: "7f3a1c92-4b8e-4d21-9a77-2e5b8c1d0f43", shortId: "7f3a1c92",
    title: "Billing webhook retries", groupId: "g-northwind", runtime: "claude",
    model: "claude-sonnet-4-6", status: "working", tier: 1,
    cwd: `${CODE}/nw-wt-billing`, gitBranch: "feat/webhook-retry",
    startedAt: t(96), lastActivityAt: t(0),
    tokens: { input: 41_820, output: 9_140, cacheRead: 388_400, cacheWrite: 22_600 },
    costEstimateUsd: 1.42, incognito: false, remoteControlled: false, entrypoint: "abcd",
    pinnedToGroup: false, outsideRoot: false, linearRefs: ["NW-812"], columnId: "c-1",
  },
  {
    id: "22d0a729-1f4c-42aa-8b90-6d3e7f2a4c11", shortId: "22d0a729",
    title: "Search relevance regression", groupId: "g-northwind", runtime: "claude",
    model: "claude-opus-5", status: "needs-input", tier: 2,
    cwd: `${CODE}/nw-wt-search`, gitBranch: "fix/relevance-drift",
    startedAt: t(210), lastActivityAt: t(6),
    tokens: { input: 88_300, output: 21_770, cacheRead: 902_100, cacheWrite: 48_900 },
    costEstimateUsd: 6.18, incognito: false, remoteControlled: true, entrypoint: "claude-vscode",
    pinnedToGroup: true, outsideRoot: false, linearRefs: ["NW-790", "NW-791"], columnId: "c-1",
  },
  {
    id: "c2df0141-9a3b-4e77-b1c8-5f0d2e9a7b34", shortId: "c2df0141",
    title: "Invoice PDF layout", groupId: "g-northwind", runtime: "codex",
    model: "gpt-5-codex", status: "completed", tier: 3,
    cwd: `${CODE}/northwind-web`, gitBranch: "main",
    startedAt: t(430), lastActivityAt: t(122),
    tokens: { input: 12_400, output: 5_030, cacheRead: 0, cacheWrite: 0 },
    costEstimateUsd: 0.31, incognito: false, remoteControlled: true, entrypoint: "terminal",
    pinnedToGroup: false, outsideRoot: false, linearRefs: [], columnId: "c-2",
  },
  {
    id: "3916bc66-77de-4b02-9c14-8a1f3d6e0b25", shortId: "3916bc66",
    title: "Rate-limit middleware", groupId: "g-northwind", runtime: "claude",
    model: "claude-sonnet-4-6", status: "failed", tier: 1,
    cwd: `${CODE}/northwind-api`, gitBranch: "feat/ratelimit",
    startedAt: t(300), lastActivityAt: t(64),
    tokens: { input: 22_100, output: 4_400, cacheRead: 140_200, cacheWrite: 9_100 },
    costEstimateUsd: 0.74, incognito: false, remoteControlled: false, entrypoint: "abcd",
    pinnedToGroup: false, outsideRoot: false, linearRefs: ["NW-820"], columnId: "c-2",
  },
  {
    id: "6b1bd1d3-0c2a-4f19-83e5-7b4a1c8d2e60", shortId: "6b1bd1d3",
    title: "Wire up the run engine", groupId: "g-oss", runtime: "claude",
    model: "claude-opus-5", status: "working", tier: 1,
    cwd: `${CODE}/abcd`, gitBranch: "feat/run-engine",
    startedAt: t(150), lastActivityAt: t(1),
    tokens: { input: 63_900, output: 18_220, cacheRead: 611_500, cacheWrite: 31_400 },
    costEstimateUsd: 4.05, incognito: false, remoteControlled: false, entrypoint: "abcd",
    pinnedToGroup: false, outsideRoot: false, linearRefs: [], columnId: "c-3",
  },
  {
    id: "e72e077d-5b81-4a3c-9f26-0d7c4e1b2a58", shortId: "e72e077d",
    title: "README screenshots", groupId: "g-oss", runtime: "claude",
    model: "claude-haiku-4-5-20251001", status: "idle", tier: 1,
    cwd: `${CODE}/abcd`, gitBranch: "docs/readme",
    startedAt: t(260), lastActivityAt: t(41),
    tokens: { input: 8_900, output: 2_100, cacheRead: 44_000, cacheWrite: 3_200 },
    costEstimateUsd: 0.09, incognito: false, remoteControlled: false, entrypoint: "abcd",
    pinnedToGroup: false, outsideRoot: false, linearRefs: [], columnId: "c-3",
  },
  {
    id: "a41c8e30-6d92-4b55-af03-1e8b7c2d9f47", shortId: "a41c8e30",
    title: "Citation checker false positives", groupId: "g-oss", runtime: "claude",
    model: "claude-sonnet-4-6", status: "needs-input", tier: 1,
    cwd: `${CODE}/cite-guard`, gitBranch: "fix/false-positive",
    startedAt: t(190), lastActivityAt: t(12),
    tokens: { input: 30_400, output: 7_800, cacheRead: 210_000, cacheWrite: 14_100 },
    costEstimateUsd: 1.11, incognito: false, remoteControlled: false, entrypoint: "abcd",
    pinnedToGroup: false, outsideRoot: false, linearRefs: [], columnId: "c-4",
  },
  {
    id: "9d5f2b18-3a70-4c66-8e91-4b2d0a7f6c35", shortId: "9d5f2b18",
    title: "Weekly review", groupId: "g-personal", runtime: "claude",
    model: "claude-sonnet-4-6", status: "completed", tier: 1,
    cwd: `${HOME}/vault`, gitBranch: null,
    startedAt: t(520), lastActivityAt: t(300),
    tokens: { input: 15_600, output: 6_400, cacheRead: 88_000, cacheWrite: 5_000 },
    costEstimateUsd: 0.48, incognito: false, remoteControlled: false, entrypoint: "abcd",
    pinnedToGroup: false, outsideRoot: false, linearRefs: [], columnId: "c-5",
  },
  {
    id: "0e8a4d71-2c95-4f38-b6a2-9c1e5d0b7a83", shortId: "0e8a4d71",
    title: "Untitled session", groupId: "g-personal", runtime: "claude",
    model: "claude-sonnet-4-6", status: "idle", tier: 1,
    cwd: `${HOME}/scratch`, gitBranch: null,
    startedAt: t(35), lastActivityAt: t(18),
    tokens: { input: 2_100, output: 640, cacheRead: 0, cacheWrite: 0 },
    costEstimateUsd: 0.03, incognito: true, remoteControlled: false, entrypoint: "abcd",
    pinnedToGroup: false, outsideRoot: true, linearRefs: [], columnId: "c-5",
  },
  {
    id: "5c7e1a94-8b03-4d27-9f15-3a6c2e8b0d41", shortId: "5c7e1a94",
    title: "Model latency benchmark", groupId: "g-research", runtime: "codex",
    model: "gpt-5-codex", status: "working", tier: 1,
    cwd: `${CODE}/bench-harness`, gitBranch: "main",
    startedAt: t(75), lastActivityAt: t(2),
    tokens: { input: 19_800, output: 8_900, cacheRead: 0, cacheWrite: 0 },
    costEstimateUsd: 0.62, incognito: false, remoteControlled: false, entrypoint: "abcd",
    pinnedToGroup: false, outsideRoot: false, linearRefs: [], columnId: "c-6",
  },
];

export const turns: Turn[] = [
  { id: "t1", sessionId: "7f3a1c92-4b8e-4d21-9a77-2e5b8c1d0f43", role: "user", at: t(96),
    text: "Webhook deliveries to Stripe are retrying forever on 5xx. Cap it at 5 attempts with exponential backoff and a dead-letter table." },
  { id: "t2", sessionId: "7f3a1c92-4b8e-4d21-9a77-2e5b8c1d0f43", role: "assistant", at: t(94),
    text: "Found the retry loop in the delivery worker — it has no attempt ceiling, so a persistent 5xx requeues indefinitely. I'll add an attempt counter, exponential backoff with jitter, and a dead_letter_deliveries table.",
    thinking: "The requeue path never increments a counter, so every failure looks like the first.",
    toolCalls: [
      { id: "tc1", name: "Grep", summary: "requeue| retry_count", status: "ok", durationMs: 340 },
      { id: "tc2", name: "Read", summary: "src/workers/delivery.ts", status: "ok", durationMs: 120 },
    ] },
  { id: "t3", sessionId: "7f3a1c92-4b8e-4d21-9a77-2e5b8c1d0f43", role: "user", at: t(52),
    text: "Good. Add a migration too, and make the backoff configurable." },
  { id: "t4", sessionId: "7f3a1c92-4b8e-4d21-9a77-2e5b8c1d0f43", role: "assistant", at: t(50),
    text: "Migration written and applied locally. Backoff base and ceiling now read from config with sane defaults. Running the worker test suite.",
    toolCalls: [
      { id: "tc3", name: "Write", summary: "migrations/0042_dead_letter.sql", status: "ok", durationMs: 90 },
      { id: "tc4", name: "Edit", summary: "src/workers/delivery.ts", status: "ok", durationMs: 210 },
      { id: "tc5", name: "Bash", summary: "npm test -- workers", status: "running" },
    ] },
  { id: "t5", sessionId: "22d0a729-1f4c-42aa-8b90-6d3e7f2a4c11", role: "user", at: t(210),
    text: "Relevance dropped after the tokenizer change. Find out why before we ship anything else." },
  { id: "t6", sessionId: "22d0a729-1f4c-42aa-8b90-6d3e7f2a4c11", role: "assistant", at: t(6),
    text: "The new tokenizer lowercases before stripping diacritics, so accented terms no longer match their indexed form. Roughly 8% of the corpus is affected. Reversing the order fixes it, but the index needs a full rebuild — about 40 minutes. Do you want me to start it?",
    toolCalls: [{ id: "tc6", name: "Bash", summary: "scripts/eval-relevance.sh --sample 5000", status: "ok", durationMs: 184_000 }] },
  { id: "t7", sessionId: "6b1bd1d3-0c2a-4f19-83e5-7b4a1c8d2e60", role: "user", at: t(150),
    text: "Spawn a session, stream stream-json into the store, and render it live. Tier 1 only for now." },
  { id: "t8", sessionId: "6b1bd1d3-0c2a-4f19-83e5-7b4a1c8d2e60", role: "assistant", at: t(1),
    text: "Streaming works end to end. Partial messages arrive on --include-partial-messages and land in the turn store without a flush delay. Interrupt is wired to SIGINT and the session survives it. Next is the permission gate.",
    toolCalls: [
      { id: "tc7", name: "Write", summary: "packages/core/run/spawn.ts", status: "ok", durationMs: 160 },
      { id: "tc8", name: "Bash", summary: "node --test packages/core", status: "ok", durationMs: 4_200 },
    ] },
  { id: "t9", sessionId: "a41c8e30-6d92-4b55-af03-1e8b7c2d9f47", role: "assistant", at: t(12),
    text: "Two of the five flagged citations are real and two are formatting artefacts. The fifth is ambiguous — the source exists but the pinpoint is wrong. Should the checker fail the build on ambiguous, or warn?" },
  { id: "t10", sessionId: "5c7e1a94-8b03-4d27-9f15-3a6c2e8b0d41", role: "assistant", at: t(2),
    text: "Warm-cache p50 is 1.9s, cold p50 is 4.4s. Running the long-context pass now.",
    toolCalls: [{ id: "tc9", name: "Bash", summary: "python bench.py --long-context", status: "running" }] },
];

export const outputs: Output[] = [
  { id: "o1", sessionId: "7f3a1c92-4b8e-4d21-9a77-2e5b8c1d0f43", kind: "file", label: "delivery.ts", path: "src/workers/delivery.ts", at: t(50), detail: "+64 −18" },
  { id: "o2", sessionId: "7f3a1c92-4b8e-4d21-9a77-2e5b8c1d0f43", kind: "file", label: "0042_dead_letter.sql", path: "migrations/0042_dead_letter.sql", at: t(51), detail: "new file" },
  { id: "o3", sessionId: "7f3a1c92-4b8e-4d21-9a77-2e5b8c1d0f43", kind: "commit", label: "fix: cap webhook retries at 5", path: "a91c4f2", at: t(48) },
  { id: "o4", sessionId: "22d0a729-1f4c-42aa-8b90-6d3e7f2a4c11", kind: "artifact", label: "Relevance drift report", path: "reports/relevance-drift.html", at: t(8) },
  { id: "o5", sessionId: "22d0a729-1f4c-42aa-8b90-6d3e7f2a4c11", kind: "memory", label: "tokenizer-ordering-trap", path: "memory/tokenizer-ordering-trap.md", at: t(7), detail: "Lowercase before diacritic strip breaks accented matching" },
  { id: "o6", sessionId: "6b1bd1d3-0c2a-4f19-83e5-7b4a1c8d2e60", kind: "file", label: "spawn.ts", path: "packages/core/run/spawn.ts", at: t(3), detail: "new file" },
  { id: "o7", sessionId: "6b1bd1d3-0c2a-4f19-83e5-7b4a1c8d2e60", kind: "pr", label: "#12 Run engine, tier 1", path: "github.com/operator/abcd/pull/12", at: t(2) },
  { id: "o8", sessionId: "c2df0141-9a3b-4e77-b1c8-5f0d2e9a7b34", kind: "file", label: "invoice.tsx", path: "src/pdf/invoice.tsx", at: t(130), detail: "+112 −40" },
  { id: "o9", sessionId: "9d5f2b18-3a70-4c66-8e91-4b2d0a7f6c35", kind: "memory", label: "week-36-review", path: "vault/10-Sessions/week-36-review.md", at: t(300) },
  { id: "o10", sessionId: "3916bc66-77de-4b02-9c14-8a1f3d6e0b25", kind: "file", label: "ratelimit.ts", path: "src/middleware/ratelimit.ts", at: t(70), detail: "+31 −0" },
];

export const tasks: Task[] = [
  { id: "k1", sessionId: "7f3a1c92-4b8e-4d21-9a77-2e5b8c1d0f43", subject: "Cap retries at 5 attempts", status: "completed", blockedBy: [] },
  { id: "k2", sessionId: "7f3a1c92-4b8e-4d21-9a77-2e5b8c1d0f43", subject: "Exponential backoff with jitter", status: "completed", blockedBy: [] },
  { id: "k3", sessionId: "7f3a1c92-4b8e-4d21-9a77-2e5b8c1d0f43", subject: "Dead-letter table + migration", status: "completed", blockedBy: [] },
  { id: "k4", sessionId: "7f3a1c92-4b8e-4d21-9a77-2e5b8c1d0f43", subject: "Worker test suite green", status: "in_progress", blockedBy: ["k3"] },
  { id: "k5", sessionId: "7f3a1c92-4b8e-4d21-9a77-2e5b8c1d0f43", subject: "Backfill stuck deliveries", status: "pending", blockedBy: ["k4"] },
  { id: "k6", sessionId: "6b1bd1d3-0c2a-4f19-83e5-7b4a1c8d2e60", subject: "Spawn + stream tier 1", status: "completed", blockedBy: [] },
  { id: "k7", sessionId: "6b1bd1d3-0c2a-4f19-83e5-7b4a1c8d2e60", subject: "Interrupt and resume", status: "completed", blockedBy: [] },
  { id: "k8", sessionId: "6b1bd1d3-0c2a-4f19-83e5-7b4a1c8d2e60", subject: "Permission gate with snapshot", status: "in_progress", blockedBy: ["k7"] },
  { id: "k9", sessionId: "6b1bd1d3-0c2a-4f19-83e5-7b4a1c8d2e60", subject: "Fork from any turn", status: "pending", blockedBy: ["k8"] },
  { id: "k10", sessionId: "22d0a729-1f4c-42aa-8b90-6d3e7f2a4c11", subject: "Reproduce relevance drop", status: "completed", blockedBy: [] },
  { id: "k11", sessionId: "22d0a729-1f4c-42aa-8b90-6d3e7f2a4c11", subject: "Decide on index rebuild", status: "blocked", blockedBy: [] },
];

export const routines: Routine[] = [
  { id: "r1", name: "Morning brief", description: "Overnight activity, open loops, what needs you first.", schedule: "Daily 08:00", lastRun: t(240), lastResult: "ok", source: "starter", prompt: "Summarise everything that happened since I closed yesterday, ranked by what needs me first." },
  { id: "r2", name: "Close the day", description: "Reconcile today's objective against what actually shipped.", schedule: "Daily 18:30", lastRun: t(1_500), lastResult: "ok", source: "starter", prompt: "Compare today's objective to the sessions that ran. What moved, what stalled, what carries to tomorrow?" },
  { id: "r3", name: "Dependency sweep", description: "Outdated and vulnerable packages across every group root.", schedule: "Weekly Mon 09:00", lastRun: t(2_900), lastResult: "failed", source: "starter", prompt: "Audit dependencies in every group root. Report only what is exploitable or blocking an upgrade." },
  { id: "r4", name: "Inbox triage", description: "Sort, draft replies, never send.", schedule: null, lastRun: t(600), lastResult: "ok", source: "user", prompt: "Triage my inbox into urgent, needs-reply, FYI and noise. Draft replies but send nothing." },
  { id: "r5", name: "Release notes", description: "Turn merged PRs into a readable changelog.", schedule: null, lastRun: null, lastResult: null, source: "user", prompt: "Read the PRs merged since the last tag and write release notes a user would actually read." },
  { id: "r6", name: "Repo health", description: "Type errors, dead code, failing tests, one score.", schedule: "Weekly Fri 16:00", lastRun: t(4_400), lastResult: "ok", source: "starter", prompt: "Run the type checker, linter and test suite in each root and give me one weighted health score with the trend." },
];

export const notes: VaultNote[] = [
  { path: "20-Projects/northwind-billing.md", title: "Northwind billing", folder: "20-Projects", tags: ["project/northwind", "area/payments"], links: ["30-Knowledge/webhook-retry-patterns.md", "10-Sessions/2026-09-07-billing.md"], updatedAt: t(50), excerpt: "Dead-letter table added. Retry ceiling is 5 with jittered backoff; the config keys are documented in the runbook." },
  { path: "30-Knowledge/webhook-retry-patterns.md", title: "Webhook retry patterns", folder: "30-Knowledge", tags: ["topic/reliability"], links: ["30-Knowledge/exponential-backoff.md"], updatedAt: t(1_200), excerpt: "Retry without a ceiling is not resilience, it is an outage amplifier. Always pair a ceiling with a dead-letter path." },
  { path: "30-Knowledge/exponential-backoff.md", title: "Exponential backoff", folder: "30-Knowledge", tags: ["topic/reliability"], links: ["30-Knowledge/webhook-retry-patterns.md"], updatedAt: t(9_000), excerpt: "Jitter is not optional. Without it, every failed client retries in lockstep and the recovery is the next outage." },
  { path: "30-Knowledge/tokenizer-ordering-trap.md", title: "Tokenizer ordering trap", folder: "30-Knowledge", tags: ["topic/search"], links: ["20-Projects/northwind-search.md"], updatedAt: t(7), excerpt: "Lowercasing before stripping diacritics silently breaks accented matching. Order matters and the tests did not cover it." },
  { path: "20-Projects/northwind-search.md", title: "Northwind search", folder: "20-Projects", tags: ["project/northwind", "area/search"], links: ["30-Knowledge/tokenizer-ordering-trap.md", "30-Knowledge/relevance-eval.md"], updatedAt: t(9), excerpt: "Relevance eval runs on a 5,000-document sample. Full rebuild is roughly 40 minutes and blocks writes." },
  { path: "30-Knowledge/relevance-eval.md", title: "Relevance evaluation", folder: "30-Knowledge", tags: ["topic/search"], links: [], updatedAt: t(20_000), excerpt: "Sampled nDCG at 10, held-out judgements refreshed quarterly." },
  { path: "20-Projects/abcd.md", title: "abcd", folder: "20-Projects", tags: ["project/abcd", "area/oss"], links: ["30-Knowledge/agent-harness-patterns.md"], updatedAt: t(2), excerpt: "The run engine is the product. Everything else is a solved visualisation problem waiting to be imported." },
  { path: "30-Knowledge/agent-harness-patterns.md", title: "Agent harness patterns", folder: "30-Knowledge", tags: ["topic/agents"], links: ["20-Projects/abcd.md"], updatedAt: t(400), excerpt: "Context is a variable, not a transcript. Sub-agents are function calls. The agent maintains its own scaffolding." },
  { path: "10-Sessions/2026-09-07-billing.md", title: "Billing session log", folder: "10-Sessions", tags: ["session/claude-code"], links: ["20-Projects/northwind-billing.md"], updatedAt: t(48), excerpt: "Capped retries, wrote the migration, tests still running at close." },
  { path: "50-Archives/legacy-payments.md", title: "Legacy payments", folder: "50-Archives", tags: ["archive"], links: [], updatedAt: t(90_000), excerpt: "Superseded by the current billing pipeline. Kept for the refund edge cases only." },
];

export const systemNodes: SystemNode[] = [
  { id: "n-runtime-claude", kind: "runtime", label: "Claude Code", detail: "v2.1.178 · tiers 1–3", x: 460, y: 60, status: "ok", meta: { sessions: "8", socket: "available" } },
  { id: "n-runtime-codex", kind: "runtime", label: "Codex", detail: "tiers 1 and 3 only", x: 700, y: 60, status: "warn", meta: { sessions: "2", socket: "none" } },
  { id: "n-memory", kind: "memory", label: "Memory layer", detail: "L0 raw → L3 index", x: 160, y: 200, status: "ok", meta: { files: "168", index: "MEMORY.md" } },
  { id: "n-vault", kind: "memory", label: "Vault", detail: "Obsidian, 60.8k notes", x: 160, y: 320, status: "ok", meta: { folders: "9", backlinks: "pre-computed" } },
  { id: "n-index", kind: "memory", label: "abcd index", detail: "SQLite, append-only", x: 160, y: 440, status: "ok", meta: { sessions: "603", since: "day one" } },
  { id: "n-skills", kind: "skill", label: "Skills", detail: "41 with SKILL.md", x: 460, y: 200, status: "ok", meta: { enabled: "38", proposed: "3" } },
  { id: "n-agents", kind: "agent", label: "Agents", detail: "9 definitions", x: 460, y: 320, status: "ok", meta: { models: "opus, sonnet, haiku" } },
  { id: "n-hooks", kind: "hook", label: "Hooks", detail: "6 events wired", x: 460, y: 440, status: "warn", meta: { slowest: "SessionStart 380ms" } },
  { id: "n-mcp", kind: "connector", label: "MCP servers", detail: "12 connected, 1 failing", x: 760, y: 200, status: "warn", meta: { failing: "analytics" } },
  { id: "n-plugins", kind: "connector", label: "Plugins", detail: "4 installed", x: 760, y: 320, status: "ok", meta: { marketplaces: "2" } },
  { id: "n-routines", kind: "routine", label: "Routines", detail: "6 defined, 4 scheduled", x: 760, y: 440, status: "ok", meta: { nextRun: "08:00" } },
  { id: "n-machine", kind: "machine", label: "This machine", detail: "macOS · 10 live sessions", x: 460, y: 570, status: "ok", meta: { cpu: "31%", mem: "18.4 GB" } },
];

export const systemEdges: SystemEdge[] = [
  { from: "n-runtime-claude", to: "n-skills", kind: "reads" },
  { from: "n-runtime-claude", to: "n-agents", kind: "reads" },
  { from: "n-runtime-claude", to: "n-hooks", kind: "triggers" },
  { from: "n-runtime-claude", to: "n-memory", kind: "writes" },
  { from: "n-runtime-claude", to: "n-mcp", kind: "depends" },
  { from: "n-runtime-codex", to: "n-index", kind: "writes" },
  { from: "n-memory", to: "n-vault", kind: "writes" },
  { from: "n-hooks", to: "n-memory", kind: "reads" },
  { from: "n-routines", to: "n-runtime-claude", kind: "triggers" },
  { from: "n-plugins", to: "n-skills", kind: "depends" },
  { from: "n-runtime-claude", to: "n-index", kind: "writes" },
  { from: "n-machine", to: "n-runtime-claude", kind: "depends" },
  { from: "n-machine", to: "n-runtime-codex", kind: "depends" },
];

export const usage: UsageDay[] = (() => {
  const out: UsageDay[] = [];
  const today = new Date();
  for (let i = 181; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const dow = d.getDay();
    const weekend = dow === 0 || dow === 6;
    // deterministic pseudo-random so the heatmap is stable across reloads
    const seed = (d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate()) % 97;
    const base = weekend ? seed % 3 : 2 + (seed % 11);
    const sessions = Math.max(0, base);
    const tokens = sessions * (28_000 + (seed % 40) * 1_400);
    out.push({
      date: d.toISOString().slice(0, 10),
      sessions,
      tokens,
      costEstimateUsd: Math.round(tokens * 0.0000042 * 100) / 100,
    });
  }
  return out;
})();

export const settings: SettingsState = {
  model: "claude-sonnet-4-6",
  effortLevel: "high",
  permissionMode: "default",
  theme: "system",
  density: "comfortable",
  keepAwake: false,
  idleMinutes: 15,
  showEstimatedCost: true,
  telemetry: false,
  incognitoByDefault: false,
  vaultPath: `${HOME}/vault`,
  allow: ["Bash(git status*)", "Bash(git diff*)", "Bash(npm test*)", "Read(**)", "Grep(**)"],
  deny: ["Bash(rm -rf /*)", "Bash(git push --force*)", "Write(**/.env)"],
  env: { ABCD_DEMO: "1", NODE_ENV: "development" },
  hooks: [
    { event: "SessionStart", command: "hooks/session-board.py", timeoutMs: 8_000, lastExitCode: 0, lastRunMs: 52 },
    { event: "SessionStart", command: "hooks/memory-recall.py", timeoutMs: 6_000, lastExitCode: 0, lastRunMs: 380 },
    { event: "PreToolUse", command: "hooks/plan-gate.py", timeoutMs: 3_000, lastExitCode: 0, lastRunMs: 21 },
    { event: "PostToolUse", command: "hooks/verify-gate.py", timeoutMs: 3_000, lastExitCode: 1, lastRunMs: 44 },
    { event: "UserPromptSubmit", command: "hooks/skill-router.mjs", timeoutMs: 3_000, lastExitCode: 0, lastRunMs: 96 },
    { event: "SessionEnd", command: "hooks/archive-session.py", timeoutMs: 10_000, lastExitCode: 0, lastRunMs: 610 },
  ],
  skills: [
    { name: "morning-brief", description: "Daily aggregation of overnight activity and open loops.", enabled: true, triggers: ["morning brief", "what happened overnight"] },
    { name: "ship", description: "Test, review, bump, changelog, commit, push, open a PR.", enabled: true, triggers: ["ship", "open a PR"] },
    { name: "qa", description: "Drive the app in a browser, find bugs, fix and re-verify.", enabled: true, triggers: ["qa", "test the site"] },
    { name: "review", description: "Pre-merge review for correctness and structural risk.", enabled: true, triggers: ["review this", "code review"] },
    { name: "humanizer", description: "Strip AI writing tells from a draft.", enabled: false, triggers: ["humanize this"] },
    { name: "benchmark", description: "Run a model latency and quality comparison.", enabled: true, triggers: ["benchmark", "compare models"] },
  ],
  connectors: [
    { name: "GitHub", kind: "mcp", status: "ok", detail: "repos, issues, PRs" },
    { name: "Linear", kind: "mcp", status: "ok", detail: "issues, projects, cycles" },
    { name: "Analytics", kind: "mcp", status: "failed", detail: "rejected the configured auth header (401)" },
    { name: "Calendar", kind: "mcp", status: "auth-required", detail: "needs authorisation in settings" },
    { name: "Filesystem", kind: "mcp", status: "ok", detail: "scoped to group roots" },
    { name: "abcd-devtools", kind: "plugin", status: "ok", detail: "v0.1.0" },
  ],
};

export const demoState: AppState = {
  user: { name: "Operator" },
  demo: true,
  today: {
    date: new Date().toISOString().slice(0, 10),
    text: "Land the retry cap, unblock search, and get the run engine streaming.",
    closedAt: null,
    reconciliation: null,
  },
  groups,
  sessions,
  turns,
  outputs,
  tasks,
  routines,
  notes,
  systemNodes,
  systemEdges,
  usage,
  settings,
};

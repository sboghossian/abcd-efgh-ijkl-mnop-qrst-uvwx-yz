/**
 * abcd data model.
 *
 * Every surface is a pure function of this state, which is why the
 * DEMO=1 mock and the real app render identical code against
 * different sources. Nothing here may reference Electron or Node.
 */

export type Runtime = "claude" | "codex";

/** Derived in core from transcript + process state. Never authored by hand. */
export type SessionStatus =
  | "working"
  | "needs-input"
  | "idle"
  | "completed"
  | "failed";

/** How far abcd can reach into a given session. See PRD / IJKL. */
export type Tier = 1 | 2 | 3;

export type EffortLevel = "low" | "medium" | "high" | "xhigh";

export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

export interface Group {
  id: string;
  name: string;
  /** Default cwd for new sessions; basis for worktree isolation. */
  primaryRoot: string;
  /** A real theme spans repositories, so one root is rarely enough. */
  extraRoots: string[];
  /** Seed for the deterministic pixel glyph. Defaults to the name. */
  glyphSeed: string;
  order: number;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface Session {
  id: string;
  /** First 8 chars of the uuid; what the UI actually shows. */
  shortId: string;
  title: string;
  groupId: string;
  runtime: Runtime;
  model: string;
  status: SessionStatus;
  tier: Tier;
  cwd: string;
  gitBranch: string | null;
  startedAt: string;
  lastActivityAt: string;
  tokens: TokenUsage;
  /** ESTIMATED from a public price table. Never presented as billed spend. */
  costEstimateUsd: number;
  incognito: boolean;
  /** entrypoint !== 'abcd' — started in VSCode or a terminal. */
  remoteControlled: boolean;
  entrypoint: "abcd" | "claude-vscode" | "terminal";
  /** Human corrected the automatic grouping; re-inference must not override. */
  pinnedToGroup: boolean;
  /** cwd falls outside every root of its group. */
  outsideRoot: boolean;
  linearRefs: string[];
  columnId: string;
}

export type TurnRole = "user" | "assistant";

export interface ToolCall {
  id: string;
  name: string;
  summary: string;
  status: "ok" | "running" | "error";
  durationMs?: number;
}

export interface Turn {
  id: string;
  sessionId: string;
  role: TurnRole;
  at: string;
  text: string;
  thinking?: string;
  toolCalls?: ToolCall[];
}

export type ArtifactKind =
  | "file"
  | "memory"
  | "artifact"
  | "pr"
  | "commit"
  | "attachment";

/** The non-developer view: what actually came out of a session. */
export interface Output {
  id: string;
  sessionId: string;
  kind: ArtifactKind;
  label: string;
  path: string;
  at: string;
  detail?: string;
}

export interface Task {
  id: string;
  sessionId: string;
  subject: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  blockedBy: string[];
}

export interface Routine {
  id: string;
  name: string;
  description: string;
  /** Human-readable, e.g. "Daily 08:00". */
  schedule: string | null;
  lastRun: string | null;
  lastResult: "ok" | "failed" | null;
  source: "starter" | "user";
  prompt: string;
}

export interface VaultNote {
  path: string;
  title: string;
  folder: string;
  tags: string[];
  /** Wikilink targets, read from the pre-computed Smart Connections footer. */
  links: string[];
  updatedAt: string;
  excerpt: string;
}

export type SystemNodeKind =
  | "memory"
  | "skill"
  | "agent"
  | "hook"
  | "connector"
  | "routine"
  | "machine"
  | "runtime";

export interface SystemNode {
  id: string;
  kind: SystemNodeKind;
  label: string;
  detail: string;
  x: number;
  y: number;
  status: "ok" | "warn" | "off";
  meta: Record<string, string>;
}

export interface SystemEdge {
  from: string;
  to: string;
  kind: "reads" | "writes" | "triggers" | "depends";
}

export interface DayObjective {
  date: string;
  text: string;
  closedAt: string | null;
  reconciliation: string | null;
}

export interface UsageDay {
  date: string;
  sessions: number;
  tokens: number;
  costEstimateUsd: number;
}

export interface HookConfig {
  event: string;
  command: string;
  timeoutMs: number | null;
  lastExitCode: number | null;
  lastRunMs: number | null;
}

export interface SkillEntry {
  name: string;
  description: string;
  enabled: boolean;
  triggers: string[];
}

export interface ConnectorEntry {
  name: string;
  kind: "mcp" | "plugin" | "marketplace";
  status: "ok" | "auth-required" | "failed";
  detail: string;
}

export interface SettingsState {
  model: string;
  effortLevel: EffortLevel;
  permissionMode: PermissionMode;
  theme: "system" | "light" | "dark";
  density: "comfortable" | "compact";
  keepAwake: boolean;
  idleMinutes: number;
  showEstimatedCost: boolean;
  telemetry: boolean;
  incognitoByDefault: boolean;
  vaultPath: string;
  allow: string[];
  deny: string[];
  env: Record<string, string>;
  hooks: HookConfig[];
  skills: SkillEntry[];
  connectors: ConnectorEntry[];
}

/** A toast raised by automatic grouping; single undo gesture. Decision 13. */
export interface GroupToast {
  id: string;
  sessionId: string;
  sessionTitle: string;
  toGroupId: string;
  at: number;
}

export type SurfaceId =
  | "home"
  | "groups"
  | "kanban"
  | "brain"
  | "system"
  | "dashboard"
  | "settings"
  | "docs"
  | "runs"
  | "day";

export interface AppState {
  user: { name: string };
  demo: boolean;
  today: DayObjective;
  groups: Group[];
  sessions: Session[];
  turns: Turn[];
  outputs: Output[];
  tasks: Task[];
  routines: Routine[];
  notes: VaultNote[];
  systemNodes: SystemNode[];
  systemEdges: SystemEdge[];
  usage: UsageDay[];
  settings: SettingsState;
}

import { useState } from "react";
import "./Settings.css";
import { useStore } from "../lib/store";
import type { ConnectorEntry, EffortLevel, PermissionMode, SettingsState } from "../lib/types";
import { shortModel } from "../lib/format";
import { IconClose, IconPlus } from "../shell/icons";

interface TabProps {
  s: SettingsState;
  patch: (p: Partial<SettingsState>) => void;
}

const TABS: { id: string; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "ai", label: "AI" },
  { id: "permissions", label: "Permissions" },
  { id: "hooks", label: "Hooks" },
  { id: "skills", label: "Skills" },
  { id: "connectors", label: "Connectors" },
  { id: "environment", label: "Environment" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "privacy", label: "Privacy" },
];

const MODEL_OPTIONS = ["claude-opus-5", "claude-sonnet-4-6", "claude-haiku-4-5-20251001", "gpt-5-codex"];

const EFFORT_OPTIONS: { value: EffortLevel; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
];

const PERMISSION_OPTIONS: { value: PermissionMode; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "acceptEdits", label: "Accept edits" },
  { value: "plan", label: "Plan first" },
  { value: "bypassPermissions", label: "Bypass permissions" },
];

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: "⌘K", action: "Open the command palette" },
  { keys: "⌘N", action: "Start a new session" },
  { keys: "⌘1 – ⌘8", action: "Jump straight to a surface" },
  { keys: "Esc", action: "Dismiss the open palette, modal, or focus mode" },
];

const CONNECTOR_CLASS: Record<ConnectorEntry["status"], string> = {
  ok: "s-working",
  "auth-required": "s-needs-input",
  failed: "s-failed",
};

const CONNECTOR_LABEL: Record<ConnectorEntry["status"], string> = {
  ok: "OK",
  "auth-required": "Auth required",
  failed: "Failed",
};

export function Settings() {
  const { app, ui, dispatch } = useStore();
  const s = app.settings;
  const patch = (p: Partial<SettingsState>) => dispatch({ type: "settings", patch: p });
  const tab = ui.settingsTab;

  return (
    <div className="settings surface-pad">
      <div className="settings-head">
        <span className="eyebrow">Settings</span>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`settings-nav-item${tab === t.id ? " on" : ""}`}
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => dispatch({ type: "settingsTab", tab: t.id })}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {tab === "appearance" && <AppearanceTab s={s} patch={patch} />}
          {tab === "ai" && <AiTab s={s} patch={patch} />}
          {tab === "permissions" && <PermissionsTab s={s} patch={patch} />}
          {tab === "hooks" && <HooksTab s={s} />}
          {tab === "skills" && <SkillsTab s={s} patch={patch} />}
          {tab === "connectors" && <ConnectorsTab s={s} />}
          {tab === "environment" && <EnvironmentTab s={s} patch={patch} />}
          {tab === "shortcuts" && <ShortcutsTab />}
          {tab === "privacy" && <PrivacyTab s={s} patch={patch} />}
        </div>
      </div>
    </div>
  );
}

/* ---------------- shared controls ---------------- */

function Segmented({
  ariaLabel,
  value,
  options,
  onChange,
}: {
  ariaLabel: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`segmented-item${value === o.value ? " on" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch${checked ? " on" : ""}`}
      onClick={onChange}
    >
      <span className="switch-knob" />
    </button>
  );
}

/* ---------------- appearance ---------------- */

function AppearanceTab({ s, patch }: TabProps) {
  const setTheme = (theme: string) => {
    const next = theme as SettingsState["theme"];
    patch({ theme: next });
    if (next === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", next);
  };

  return (
    <section className="settings-section">
      <div className="settings-field">
        <span className="settings-label">Theme</span>
        <Segmented
          ariaLabel="Theme"
          value={s.theme}
          onChange={setTheme}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
        <p className="settings-help">
          Follows your operating system by default. Choose Light or Dark to override it just for abcd.
        </p>
      </div>
      <div className="settings-field">
        <span className="settings-label">Density</span>
        <Segmented
          ariaLabel="Density"
          value={s.density}
          onChange={(v) => patch({ density: v as SettingsState["density"] })}
          options={[
            { value: "comfortable", label: "Comfortable" },
            { value: "compact", label: "Compact" },
          ]}
        />
        <p className="settings-help">
          Compact tightens row height and padding across every table and list, fitting more on screen at once.
        </p>
      </div>
    </section>
  );
}

/* ---------------- ai ---------------- */

function AiTab({ s, patch }: TabProps) {
  return (
    <section className="settings-section">
      <div className="settings-field">
        <label htmlFor="set-model" className="settings-label">Model</label>
        <select
          id="set-model"
          className="settings-select mono"
          value={s.model}
          onChange={(e) => patch({ model: e.target.value })}
        >
          {MODEL_OPTIONS.map((m) => (
            <option key={m} value={m}>{shortModel(m)}</option>
          ))}
        </select>
        <p className="settings-help">
          The model does the actual thinking for a session. Bigger models reason more carefully and cost more
          per token; smaller ones answer faster and cheaper. This only sets the default for new sessions started
          from abcd, you can still pick a different model per session.
        </p>
      </div>

      <div className="settings-field">
        <label htmlFor="set-effort" className="settings-label">Effort level</label>
        <select
          id="set-effort"
          className="settings-select"
          value={s.effortLevel}
          onChange={(e) => patch({ effortLevel: e.target.value as EffortLevel })}
        >
          {EFFORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <p className="settings-help">
          How long the model deliberates before answering. Low is fast and cheap for simple tasks. Extra high
          spends much more time reasoning, which pays off on genuinely hard problems and mostly just adds delay
          on easy ones.
        </p>
      </div>

      <div className="settings-field">
        <label htmlFor="set-permission" className="settings-label">Permission mode</label>
        <select
          id="set-permission"
          className="settings-select"
          value={s.permissionMode}
          onChange={(e) => patch({ permissionMode: e.target.value as PermissionMode })}
        >
          {PERMISSION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <div className="settings-help">
          <p>How much an agent can do before it has to stop and ask you.</p>
          <ul>
            <li><strong>Default</strong>: asks before anything that changes files or runs commands.</li>
            <li><strong>Accept edits</strong>: edits files without asking each time, but still asks before running commands.</li>
            <li><strong>Plan first</strong>: writes out a plan before touching anything, and waits for your go-ahead.</li>
            <li><strong>Bypass permissions</strong>: acts on everything without asking. Only for tasks you trust completely.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ---------------- permissions ---------------- */

function RuleList({
  title,
  rules,
  onAdd,
  onRemove,
  fail,
}: {
  title: string;
  rules: string[];
  onAdd: (v: string) => void;
  onRemove: (i: number) => void;
  fail?: boolean;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="rule-list">
      <h3 className="settings-subhead">
        {title} <span className="mono settings-count">{rules.length}</span>
      </h3>
      <ul className="rule-rows">
        {rules.map((r, i) => (
          <li key={`${r}-${i}`} className={`rule-row${fail ? " rule-row-fail" : ""}`}>
            <span className="mono rule-text">{r}</span>
            <button type="button" className="rule-remove" aria-label={`Remove rule ${r}`} onClick={() => onRemove(i)}>
              <IconClose />
            </button>
          </li>
        ))}
        {rules.length === 0 && <li className="rule-empty">No rules yet.</li>}
      </ul>
      <input
        className="rule-input mono"
        placeholder={fail ? "Bash(rm -rf /*)" : "Bash(npm run *)"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim()) {
            onAdd(draft.trim());
            setDraft("");
          }
        }}
        aria-label={`Add ${title.toLowerCase()} rule`}
      />
    </div>
  );
}

function PermissionsTab({ s, patch }: TabProps) {
  return (
    <section className="settings-section">
      <RuleList
        title="Allow"
        rules={s.allow}
        onAdd={(v) => patch({ allow: [...s.allow, v] })}
        onRemove={(i) => patch({ allow: s.allow.filter((_, idx) => idx !== i) })}
      />
      <RuleList
        title="Deny"
        rules={s.deny}
        fail
        onAdd={(v) => patch({ deny: [...s.deny, v] })}
        onRemove={(i) => patch({ deny: s.deny.filter((_, idx) => idx !== i) })}
      />
    </section>
  );
}

/* ---------------- hooks ---------------- */

function HooksTab({ s }: { s: SettingsState }) {
  return (
    <section className="settings-section">
      <p className="settings-help">
        Hook timing and exit status are not surfaced anywhere in Claude Code today. This view is the point.
      </p>
      <div className="table-scroll scroll">
        <table className="hooks-table mono">
          <thead>
            <tr>
              <th>Event</th>
              <th>Command</th>
              <th>Timeout</th>
              <th>Exit</th>
              <th>Last run</th>
            </tr>
          </thead>
          <tbody>
            {s.hooks.map((h, i) => (
              <tr key={`${h.event}-${h.command}-${i}`}>
                <td>{h.event}</td>
                <td className="hooks-command">{h.command}</td>
                <td>{h.timeoutMs !== null ? `${h.timeoutMs}ms` : "—"}</td>
                <td className={h.lastExitCode !== null && h.lastExitCode !== 0 ? "cell-fail" : ""}>
                  {h.lastExitCode !== null ? h.lastExitCode : "—"}
                </td>
                <td className={h.lastRunMs !== null && h.lastRunMs > 300 ? "cell-warn" : ""}>
                  {h.lastRunMs !== null ? `${h.lastRunMs}ms` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------------- skills ---------------- */

function SkillsTab({ s, patch }: TabProps) {
  const toggle = (name: string) => {
    patch({ skills: s.skills.map((sk) => (sk.name === name ? { ...sk, enabled: !sk.enabled } : sk)) });
  };
  return (
    <section className="settings-section">
      <ul className="skills-list">
        {s.skills.map((sk) => (
          <li key={sk.name} className="skill-row panel-card">
            <div className="skill-row-head">
              <span className="mono skill-name">{sk.name}</span>
              <Switch checked={sk.enabled} onChange={() => toggle(sk.name)} label={`Enable ${sk.name}`} />
            </div>
            <p className="skill-desc">{sk.description}</p>
            <div className="skill-triggers">
              {sk.triggers.map((tr) => (
                <span key={tr} className="chip skill-trigger">{tr}</span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------- connectors ---------------- */

function ConnectorsTab({ s }: { s: SettingsState }) {
  return (
    <section className="settings-section">
      <div className="connectors-grid">
        {s.connectors.map((c) => (
          <div key={c.name} className="connector-card panel-card">
            <div className="connector-head">
              <span className="connector-name">{c.name}</span>
              <span className={`chip ${CONNECTOR_CLASS[c.status]}`}>{CONNECTOR_LABEL[c.status]}</span>
            </div>
            <div className="connector-meta mono">{c.kind}</div>
            <p className="connector-detail">{c.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------- environment ---------------- */

function EnvRow({
  envKey,
  value,
  onCommitKey,
  onCommitValue,
  onRemove,
}: {
  envKey: string;
  value: string;
  onCommitKey: (oldKey: string, newKey: string) => void;
  onCommitValue: (key: string, value: string) => void;
  onRemove: (key: string) => void;
}) {
  const [key, setKey] = useState(envKey);
  const [val, setVal] = useState(value);

  return (
    <li className="env-row">
      <input
        className="env-key mono"
        value={key}
        aria-label="Variable name"
        onChange={(e) => setKey(e.target.value)}
        onBlur={() => {
          if (key.trim() && key !== envKey) onCommitKey(envKey, key.trim());
        }}
      />
      <span className="env-eq mono">=</span>
      <input
        className="env-val mono"
        value={val}
        aria-label={`Value for ${envKey}`}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => {
          if (val !== value) onCommitValue(envKey, val);
        }}
      />
      <button type="button" className="rule-remove" aria-label={`Remove ${envKey}`} onClick={() => onRemove(envKey)}>
        <IconClose />
      </button>
    </li>
  );
}

function EnvironmentTab({ s, patch }: TabProps) {
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");
  const entries = Object.entries(s.env);

  const commitKey = (oldKey: string, key: string) => {
    if (key === oldKey || s.env[key] !== undefined) return;
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(s.env)) next[k === oldKey ? key : k] = v;
    patch({ env: next });
  };
  const commitValue = (key: string, value: string) => {
    patch({ env: { ...s.env, [key]: value } });
  };
  const removeKey = (key: string) => {
    const next = { ...s.env };
    delete next[key];
    patch({ env: next });
  };
  const addRow = () => {
    const key = newKey.trim();
    if (!key || s.env[key] !== undefined) return;
    patch({ env: { ...s.env, [key]: newVal } });
    setNewKey("");
    setNewVal("");
  };

  return (
    <section className="settings-section">
      <div className="settings-field">
        <h3 className="settings-subhead">
          Environment variables <span className="mono settings-count">{entries.length}</span>
        </h3>
        <ul className="env-rows">
          {entries.map(([k, v]) => (
            <EnvRow key={k} envKey={k} value={v} onCommitKey={commitKey} onCommitValue={commitValue} onRemove={removeKey} />
          ))}
          <li className="env-row env-row-new">
            <input
              className="env-key mono"
              placeholder="KEY"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              aria-label="New variable name"
            />
            <span className="env-eq mono">=</span>
            <input
              className="env-val mono"
              placeholder="value"
              value={newVal}
              onChange={(e) => setNewVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addRow();
              }}
              aria-label="New variable value"
            />
            <button type="button" className="btn btn-ghost env-add" onClick={addRow} aria-label="Add variable">
              <IconPlus />
            </button>
          </li>
        </ul>
      </div>

      <div className="settings-field">
        <label htmlFor="vault-path" className="settings-label">Vault path</label>
        <input
          id="vault-path"
          className="settings-input mono"
          value={s.vaultPath}
          onChange={(e) => patch({ vaultPath: e.target.value })}
        />
        <p className="settings-help">Where abcd reads and writes vault notes and their backlink footers.</p>
      </div>

      <div className="settings-field">
        <div className="settings-row-inline">
          <span className="settings-label">Keep awake</span>
          <Switch checked={s.keepAwake} onChange={() => patch({ keepAwake: !s.keepAwake })} label="Keep awake" />
        </div>
        <p className="settings-help">
          Wraps the app so a closed laptop does not strand a session that is still working. This costs battery,
          so leave it off if you are fine with sessions pausing when the laptop sleeps.
        </p>
      </div>

      <div className="settings-field">
        <label htmlFor="idle-minutes" className="settings-label">Idle after</label>
        <input
          id="idle-minutes"
          type="number"
          min={1}
          className="settings-input mono settings-input-narrow"
          value={s.idleMinutes}
          onChange={(e) => {
            const n = Number(e.target.value);
            patch({ idleMinutes: Number.isNaN(n) ? 0 : n });
          }}
        />
        <p className="settings-help">Minutes of no activity before a session counts as idle.</p>
      </div>
    </section>
  );
}

/* ---------------- shortcuts ---------------- */

function ShortcutsTab() {
  return (
    <section className="settings-section">
      <div className="table-scroll scroll">
        <table className="shortcuts-table">
          <thead>
            <tr>
              <th>Keys</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {SHORTCUTS.map((r) => (
              <tr key={r.keys}>
                <td className="mono">{r.keys}</td>
                <td className="shortcuts-action">{r.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------------- privacy ---------------- */

function PrivacyTab({ s, patch }: TabProps) {
  return (
    <section className="settings-section">
      <div className="settings-field">
        <div className="settings-row-inline">
          <span className="settings-label">Telemetry</span>
          <Switch checked={s.telemetry} onChange={() => patch({ telemetry: !s.telemetry })} label="Telemetry" />
        </div>
        <p className="settings-help">
          Off by default. abcd sends nothing about your sessions or prompts unless you turn this on.
        </p>
      </div>

      <div className="settings-field">
        <div className="settings-row-inline">
          <span className="settings-label">Incognito by default</span>
          <Switch
            checked={s.incognitoByDefault}
            onChange={() => patch({ incognitoByDefault: !s.incognitoByDefault })}
            label="Incognito by default"
          />
        </div>
        <p className="settings-help">
          New sessions start incognito unless you opt them in. Nothing from them is written to the vault, the
          brain, or the audit log.
        </p>
      </div>

      <div className="settings-field">
        <div className="settings-row-inline">
          <span className="settings-label">Show estimated cost</span>
          <Switch
            checked={s.showEstimatedCost}
            onChange={() => patch({ showEstimatedCost: !s.showEstimatedCost })}
            label="Show estimated cost"
          />
        </div>
        <p className="settings-help">
          Shows the estimated dollar cost of each session next to its token count. It is always an estimate from
          a public price table, never a billed amount.
        </p>
      </div>

      <div className="settings-field">
        <h3 className="settings-subhead">Audit log</h3>
        <p className="settings-help">
          abcd keeps a local audit log of what it did on your behalf: files touched, commands run, prompts sent.
          It never leaves your machine, and incognito sessions never appear in it.
        </p>
      </div>
    </section>
  );
}

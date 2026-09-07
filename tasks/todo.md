# abcd — build plan

Spec: `docs/SPEC.html` (living PRD). 19 decisions locked 2026-09-07.

## Phase 0 — clickable front end (current)

- [x] Repo scaffold, Vite + React 18 + TS strict, node_modules symlinked out of iCloud
- [x] Design system — 4 type roles, accent-as-verb, mono-for-data, full light/dark
- [x] Data model (`src/lib/types.ts`) — pure JSON so mock and app share one renderer
- [x] DEMO=1 synthetic fixtures — no real data, safe for public screenshots
- [x] Shell — 56px rail, top bar, command palette, modals, grouping toast with pinning undo
- [x] Global prompt box — `@` targeting, broadcast, tier-3 unreachable marking, local dictation
- [x] Home — five-range summary that states its own index depth
- [x] Groups — group strip, columns, session tabs, drag between columns, 3 body views
- [x] Kanban — 5 derived-status columns, filters, drag shows the derived-status note
- [x] Brain — lobe view + full vault browser with backlinks
- [x] System — pan/zoom canvas, typed edges, node inspector
- [x] Dashboard — 182-day heatmap, token chart, spend by group, widget catalogue
- [x] Settings — 9 tabs, every control bound to state
- [x] Docs — 8 topics, in-app, doubles as README source
- [x] README + AGPL licence
- [x] Production build green
- [ ] QA pass across all 12 surfaces, both themes
- [ ] Public GitHub repo — BLOCKED, needs Stephane's approval
- [ ] Screenshots for README from DEMO=1

## Phase 1 — read-only truth

- [ ] Port Cockpit data layer into `packages/core` (plain Node, zero Electron imports, lint-enforced)
- [ ] Session registry poller — `~/.claude/sessions/<pid>.json`
- [ ] Transcript parser — `*.jsonl`, `parentUuid` tree
- [ ] SQLite history index — ships first; history cannot be backfilled
- [ ] Settings / skills / agents / hooks readers

## Phase 2 — the run engine

- [ ] `RuntimeAdapter` interface; Claude Code as first implementation
- [ ] Tier 1 spawn + stream + interrupt + resume + fork
- [ ] Permission gate with pre-action snapshot and sha256-verified revert

## Phase 3 — reach and the day

- [ ] Tier 2 socket control with version detection and read-only fallback
- [ ] Broadcast, wind-down, day open/close reconciliation

## Phase 4 — harness surfaces on real data
## Phase 5 — open source, signed macOS build
## Phase 6 — Linux, then Windows

## Open questions (YZ tab of the spec)

- Q9 worktree per session inside a group root?
- Q10 how much Codex parity does v1 need?
- Q11 whisper.cpp distribution — bundle, detect, or download?

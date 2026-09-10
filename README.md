<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.zh-TW.md">繁體中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.es.md">Español</a>
</p>

# my-flow

A lightweight workflow layer that works the same way in **Claude Code** and **Codex CLI**. It adds no runtime and depends on no external tool. It gives you:

- one four-stage flow: `interview → mf-plan → execute → mf-verify`
- seven skills and four subagent roles (three of them read-only)
- two hooks: inject the active change on session start, block fake "done" claims on stop
- a cross-model advisor: Claude asks Codex, Codex asks Claude, always read-only
- an **intent layer**: `specs/` holds the current truth, `changes/<name>/` holds the intent of one change. The structure is borrowed from OpenSpec, but my-flow ships its own `new / status / validate / archive`, so OpenSpec itself is not required

Everything that oh-my-claudecode and oh-my-codex used to wrap (agent teams, `/goal`, worktrees, hooks, skills, plugins) is used directly through the native features of both CLIs.

## Table of contents

1. [Positioning](#positioning)
2. [Requirements](#requirements)
3. [Quick start](#quick-start)
4. [Concepts](#concepts)
5. [CLI commands](#cli-commands)
6. [Skills](#skills)
7. [Subagent roles](#subagent-roles)
8. [Hooks](#hooks)
9. [Cross-model advisor](#cross-model-advisor)
10. [Dashboard](#dashboard)
11. [The intent layer](#the-intent-layer)
12. [Repository layout and single-source authoring](#repository-layout-and-single-source-authoring)
13. [Installing into Codex](#installing-into-codex)
14. [Troubleshooting](#troubleshooting)
15. [License](#license)

## Positioning

| Tool / project | Role |
|---|---|
| Claude Code | Primary executor for daily interactive development (native agent teams + `/goal`) |
| Codex | Advisor and cross-verifier: reviews designs and diffs, breaks ties. Implements only when you explicitly invoke `$my-flow-execute` |
| OpenSpec | Only its ideas and directory structure are borrowed (specs / changes / delta specs / tasks.md checkboxes). No CLI, no `/opsx` commands |
| oh-my-claudecode | Optional. my-flow already covers the cross-model advisor and skill extraction; use claude-hud for the HUD |
| oh-my-codex | Not needed. Its flow conventions are distilled into `src/core/core.md` and the skills |

## Requirements

- Node.js 20 or newer (the scripts and hooks are plain Node, no dependencies)
- Claude Code 2.1.x for the Claude side
- Codex CLI 0.135 or newer for the Codex side (features `hooks`, `goals`, `multi_agent` enabled)
- Windows 11 is the primary target; everything runs without tmux or WSL. macOS and Linux work with the same scripts

## Quick start

```bash
git clone https://github.com/Qither/my-flow.git
cd my-flow

# 1. Claude Code: enable agent teams and install the working agreement into ~/.claude/CLAUDE.md
node scripts/install.mjs claude

# 2. Load the plugin (development) ...
claude --plugin-dir /path/to/my-flow
# ... or install it from the local marketplace (stable)
claude plugin marketplace add /path/to/my-flow
claude plugin install my-flow@my-flow

# 3. Set up a project
cd /path/to/your/project
node /path/to/my-flow/scripts/init.mjs

# 4. Start a change
node /path/to/my-flow/scripts/spec.mjs new my-first-change
```

Then, inside Claude Code: `/my-flow:interview my-first-change` → `/my-flow:mf-plan my-first-change` → `/my-flow:execute my-first-change` → `/my-flow:mf-verify my-first-change`.

The Codex side is optional; see [Installing into Codex](#installing-into-codex).

## Concepts

### The four stages

| Your request looks like | Stages to use |
|---|---|
| Concrete, single file, clear acceptance | `execute` only (or just do it) |
| Concrete but multi-file or multi-module | `mf-plan → execute → mf-verify` |
| Concrete, multi-file, design already clear | `mf-plan --fast [--go] → execute → mf-verify` |
| Vague, no acceptance criteria, "should we..." | `interview → mf-plan → execute → mf-verify` |
| Touches build config, shaders, engine modules, migrations, auth | never skip `mf-plan` and `mf-verify` |

Rules that hold across stages:

- `interview` asks one question per round and stops only when non-goals and decision boundaries are explicit.
- `mf-plan` never implements. `execute` never redesigns; if the design is wrong, stop and go back.
- `mf-verify` always runs in a separate context from the one that wrote the code.
- `tasks.md` checkboxes are the only progress ledger. A box is ticked only after that task's own verification passed.

### Why the `mf-` prefix

Claude Code has a built-in `/plan` (plan mode) and bundled skills named `run` and `verify`. Plugin skills are always namespaced (`/my-flow:...`), so nothing is overwritten, but the model picks skills by name and description. Distinct names remove the ambiguity:

| Stage | Skill | Why not the obvious name |
|---|---|---|
| Interview | `interview` | no conflict |
| Plan | `mf-plan` | built-in `/plan` is plan mode |
| Execute | `execute` | built-in skill `run` launches the project's app |
| Verify | `mf-verify` | built-in skill `verify` |

### One loop authority per session

In Claude Code, at most one `/goal` and at most one agent team per session. `execute` prints the `/goal` statement and waits for you to paste it (skills cannot set it themselves); the Stop hook is only a backstop that blocks completion claims leaving unticked tasks during `execute`, and only while the state written by `spec stage` is fresh. In Codex, one goal per thread; `execute` calls `create_goal` only when none is active. A run entered from `mf-plan --fast --go` also pauses once for the `/goal` paste.

### What Claude and Codex each do

Claude Code does the interactive work and runs the loops. Codex reviews, plans, verifies, and answers `ask` requests. It implements only when you explicitly invoke `$my-flow-execute`. No tmux, no team runtime, no state daemons are involved on either side.

## CLI commands

All commands are plain Node scripts. `node scripts/cli.mjs <command>` (or `my-flow <command>` after `npm link`) dispatches to them.

| Command | What it does | Notes |
|---|---|---|
| `build [--check]` | Renders `src/` into the Claude plugin and the Codex surface | Run after editing `src/`. `--check` only compares and exits 1 when outputs are stale |
| `install claude [--dry-run]` | Backs up `~/.claude/settings.json`, sets `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, upserts the working agreement into `~/.claude/CLAUDE.md`. On Windows also registers the scheduled task `my-flow-models-check` (`conhost.exe --headless node scripts/models.mjs check --quiet --home <MY_FLOW_HOME>`) and records the tool home in `~/.my-flow/config.json` | Prints the plugin install commands, does not run them |
| `install codex [--link] [--dry-run]` | Backs up, then copies skills and agent TOMLs, writes the PowerShell shim, merges `hooks.json`, writes trusted hashes into `config.toml`, upserts `~/.codex/AGENTS.md`. On Windows also registers the scheduled task `my-flow-models-check` and records the tool home and agents directory in `~/.my-flow/config.json` | `--link` uses junctions instead of copies |
| `uninstall codex [--dry-run]` | Reverses `install codex`, preserving everything else in `~/.codex`. Removes the Codex home from `~/.my-flow/config.json`; deletes the scheduled task `my-flow-models-check` only when no other surface remains |  |
| `init [--simple] [--tools claude,codex] [dir]` | Creates `specs/`, `changes/` (with `.templates/` and `archive/`), `specs/README.md`, `.claude/rules/specs.md`, `.my-flow/`, and appends a block to the project `CLAUDE.md` / `AGENTS.md` | `--simple` switches to one `docs/changes/<name>.md` per change |
| `spec new <name>` | Creates `changes/<name>/{proposal,design,tasks}.md` from templates and marks it current | kebab-case names |
| `spec status [name] [--json]` | Ticked / total tasks, artifact state (missing / empty / done), delta spec count; flags `[stale Nd]` on unfinished changes untouched for 14 days (`--stale-days`, `MY_FLOW_STALE_DAYS`), `overlap:` when two changes claim one requirement, `audit suggested:` after 5 merges into a capability (`MY_FLOW_AUDIT_EVERY`) | Untouched templates count as empty |
| `spec validate [name] [--json]` | Structural checks: required sections, task line format, scenario format, delta sections; MODIFIED / REMOVED requirements are checked against the main spec | Exit 1 on errors |
| `spec archive <name> [--force]` | Requires all boxes ticked and a PASS report under `.my-flow/verify/`; merges delta specs into `specs/` and moves the change to `changes/archive/` | `--force` skips the gate |
| `spec abandon <name> --reason "..." [--force]` | Third exit for a change that will not be finished: requires an `## Abandoned` section with a `**Reason**:` line (`--reason` appends it), moves the change to `changes/archive/<date>-<name>-abandoned/`, merges nothing | Refuses a fully ticked change (use `archive`). Also records a clean audit: `spec new audit-<cap>` then `spec abandon audit-<cap> --reason "..."` |
| `spec stage <name> <stage>` | Writes `.my-flow/state/current-change.json` (`new`, `interview`, `mf-plan`, `execute`, `done`, `archived`) with a fresh `updated` timestamp | The execute-guard only fires while this file is younger than 12 h |
| `ask <codex\|claude> [--diff] [--files a,b] [--model m] [--timeout ms] <question>` | Runs the other CLI read-only as an advisor; writes an artifact to `.my-flow/ask/` | Prompt goes through stdin; empty output counts as failure |
| `dashboard [start\|stop\|status] [--port N] [--root dir] [--json]` | Local web dashboard over `specs/`, `changes/` and `.my-flow/`: live updates, guarded editing; `stop` verifies the recorded process before terminating it | Loopback only, default port 4321, no dependencies |
| `models [status\|analyze\|apply\|reset] [--json] [--provider claude\|codex] [--dry-run]` | Subagent model routing: `status` shows the recorded CLI versions, the local override (or none) and the values read back from the installed agent files; `analyze` asks the strongest available CLI for a role -> model / effort map, validates it and applies it; `apply` re-renders the installed files from `~/.my-flow/models.json`; `reset` deletes the override and restores the inherit baseline | Writes only under `~/.my-flow/` (`MY_FLOW_HOME`), `~/.codex/agents/` and the installed Claude plugin `agents/`; never the repository |

## Skills

Claude invokes them as `/my-flow:<name>`, Codex as `$my-flow-<name>`.

| Skill | When | What it does | Output |
|---|---|---|---|
| `interview <idea> [--quick] [--change <name>]` | Vague request, no acceptance criteria | One question per round, intent before detail; scores ambiguity; exits when Non-Goals and Decision Boundaries are explicit | `changes/<name>/proposal.md`, transcript in `.my-flow/interviews/` |
| `mf-plan <name \ | text> [--deliberate] [--fast [--go]]` | Multi-file changes; anything touching build config, shaders, engine modules, migrations, auth. With `--fast` you write the artifacts yourself, one critic pass, no planner or architect; refused for the high-risk categories (and together with `--deliberate`); `--go` continues straight into execute | planner drafts → architect reviews (`CLEAR / WATCH / BLOCK`) → critic reviews (`OKAY / REJECT`), up to three rounds | `design.md` (must contain Do-Not-Touch and Rebuild / Re-run), `tasks.md` |
| `execute <name> [--team] [--worktree]` | `tasks.md` has unticked boxes | Composes the goal statement; implements task by task, verifies, ticks; runs the fixed final gate. Can also be entered from `mf-plan --fast --go`, which also pauses for the `/goal` paste | Claude: prints `/goal …` for you to paste. Codex: `create_goal` |
| `mf-verify <name \| criteria>` | Before any "done" claim | Delegates to the read-only verifier, which runs the checks itself and reports per criterion | `.my-flow/verify/<name>-<time>.md` with PASS / FAIL / INCOMPLETE |
| `mf-audit <capability \| all>` | `spec status` prints `audit suggested`, or the user says "audit the spec" | Read-only architect pass comparing `specs/<cap>/spec.md` with code and tests: unimplemented requirements, undocumented behavior, contradictions, misplaced requirements; never edits `specs/` | `.my-flow/verify/audit-<cap>-<time>.md` with `Status: CLEAN / DRIFT / BROKEN` and a suggested change name ending in `audit-<cap>` |
| `ask <codex\|claude> [--diff] [--files] <question>` | Second opinion on a design, diff review before the final gate, tie-break when planning stalls | Wraps the `ask` script, summarizes, and states whether it agrees | `.my-flow/ask/` |
| `learn [name] [--dry-run]` | The session solved something project-specific and hard | Three-question quality gate, then extracts a SKILL.md | Written to both `.claude/skills/` and `.agents/skills/` |
| `spec new\|status\|validate\|abandon\|archive\|stage` | Managing the intent layer | Wraps the `spec` script and interprets its output | same as the script |
| `dashboard start\|stop\|status` | Watching a change in a browser, editing a proposal or spec outside the terminal | Wraps the `dashboard` script: starts it detached and prints the URL, or stops it | `.my-flow/state/dashboard.json` |

`learn` has `disable-model-invocation`; only you can call it.

### How the three flow skills differ from the built-ins

- **`/plan` vs `mf-plan`**: plan mode is a read-only permission mode that writes one plan file outside the project and asks for approval. `mf-plan` produces committed artifacts (`design.md`, `tasks.md`) reviewed by three roles in sequence, with required sections and a task format that later drives `execute` and `mf-verify`. You can still enter `/plan` first to explore. The fast lane `mf-plan --fast` sits between the two: same committed artifacts and downstream flow, but only one critic pass instead of the three-role consensus.
- **`run` vs `execute`**: the built-in `run` launches the project's app. `execute` is a task loop over `tasks.md` under the Do-Not-Touch and Rebuild rules, wrapped in a native goal, ending with the fixed final gate (verify → cleanup → re-verify → independent review → done).
- **`verify` vs `mf-verify`**: `mf-verify` always changes context (read-only verifier subagent), derives its criteria from `tasks.md`, spec scenarios and `design.md`, checks the diff against Do-Not-Touch, checks that Rebuild steps ran, scans for fake-completion patterns, and writes a report that `spec archive` requires.

## Subagent roles

| Role | Essence | Model | Codex effort | Codex sandbox | Tools denied |
|---|---|---|---|---|---|
| `planner` | Turns a proposal into an evidence-grounded design and task list; reads the code itself; every task names its verification | inherit | high | none | none (writes only under `changes/<name>/`) |
| `architect` | Read-only design reviewer: antithesis, tension, synthesis; `CLEAR / WATCH / BLOCK` | inherit | high | read-only | Write, Edit |
| `critic` | Decides whether the plan is executable without guessing; simulates two or three tasks; `OKAY / REJECT` with at most five fixes | inherit | medium | read-only | Write, Edit |
| `verifier` | Fresh evidence only; runs the checks itself; per-criterion status; never approves work from its own context | inherit | medium | none (stays prompt-enforced so it can run tests) | Write, Edit |

On both CLIs the roles inherit the main session's model (Claude `model: inherit`; Codex omits `model`, so the parent session's model applies), and the `models` command (section CLI commands) can override that locally per role; `models status` shows the effective values. Claude addresses them as `my-flow:planner` etc. Codex loads them from `~/.codex/agents/<name>.toml`; architect and critic run under `sandbox_mode = "read-only"`, the others are read-only by prose (and by `-s read-only` when headless).

### Model routing

The shipped baseline is `inherit` on both CLIs, so a CLI or model upgrade needs no edit. On top of that, a per-user override can route each role to a different model or effort:

- `~/.my-flow/models.json` (`MY_FLOW_HOME` overrides the directory) holds the override: one entry per role with a Claude model (`inherit`, an alias, or the main model) and a Codex model (`null` = inherit, or a model listed in `~/.codex/models_cache.json`) plus reasoning effort. `config.json` records the tool homes written by `install` and a `knownModels` list per CLI that extends the allowed set; `models-state.json` and `models.log` record what the hook and the background check did.
- The SessionStart hook only schedules: at most once per `MY_FLOW_MODELS_CHECK_HOURS` it spawns a detached `models check` that probes `claude --version` / `codex --version` and the main models. Only when they changed does the check run one read-only analysis through `ask.mjs`, validate the answer against the allowed sets (unknown models or unsupported efforts reject the whole answer), write the override and re-render the installed agent files. Failures keep the baseline; the next session start prints one `model routing ...` line.
- `node scripts/cli.mjs models status|analyze|apply|reset` exposes the same mechanism by hand. The repository files are never written by any of this.

## Hooks

| Event | Script | Behavior |
|---|---|---|
| SessionStart | `hooks/session-context.mjs` | If the project has `changes/`, lists active changes with ticked / total tasks and artifact state. Also prints the pending model-routing summary (one line, once) and, at most once per `MY_FLOW_MODELS_CHECK_HOURS` (default 1, `0` = every start), spawns a detached `models check` that probes the CLI versions and, only when they changed, runs the analysis in the background. The hook itself never calls a model and returns in well under a second. Disable the routing part with `MY_FLOW_SKIP_HOOKS=model-routing`. Always exits 0. On Windows the check is started through the scheduled task `my-flow-models-check` registered by `install claude` / `install codex` (Task Scheduler runs it outside the hook's job object, which Codex tears down); without the task, or when `schtasks /run` fails, it falls back to a detached child |
| Stop | `hooks/completion-guard.mjs` | If the last message claims completion but the diff still contains `test.skip`, `.only`, placeholder TODOs or stub returns, blocks and explains why; during `execute` it also blocks a completion claim while tasks.md still has unticked tasks not marked blocked, as long as the state file is younger than 12 h (`MY_FLOW_EXECUTE_GUARD_TTL_HOURS`). Messages without a completion claim are never blocked |

Both scripts are shared by Claude (via `hooks/hooks.json` in the plugin) and Codex (via the PowerShell shim). Disable with `MY_FLOW_SKIP_HOOKS=completion-guard`, `execute-guard` or `model-routing` (or `all`). The execute-guard TTL defaults to 12 hours; override it with `MY_FLOW_EXECUTE_GUARD_TTL_HOURS`.

## Cross-model advisor

```bash
node scripts/ask.mjs codex --diff "Review this diff for correctness"
node scripts/ask.mjs claude --files src/a.ts,src/b.ts "Is this abstraction justified?"
```

- The prompt always goes through stdin (never argv), the other CLI runs read-only (`codex exec -s read-only`, `claude -p --permission-mode plan`), with a timeout; exit 0 with empty output counts as failure.
- Artifacts land in `.my-flow/ask/<time>-<provider>-<slug>.md` with sections Original task / Final prompt / Raw output / Summary / Action items.
- Pick the model with `--model` or the environment variables `MY_FLOW_CODEX_MODEL` / `MY_FLOW_CLAUDE_MODEL` (useful when the model in your Codex config is newer than the installed CLI supports, e.g. `--model gpt-5.5`).
- `--cwd <dir>` sets the working directory and `--ask-dir <dir>` the artifact directory (the model-routing analysis uses it to keep its prompts under `~/.my-flow/ask/`).
- Disagreements are resolved by evidence or by you, never by majority.

## Dashboard

```bash
node scripts/cli.mjs dashboard start                     # http://127.0.0.1:4321/
node scripts/cli.mjs dashboard start --port 4400 --root /path/to/project
node scripts/cli.mjs dashboard status
node scripts/cli.mjs dashboard stop
```

A local web view over the intent layer, with zero dependencies: Node built-ins on the server, hand-written HTML, CSS and JavaScript in the browser, nothing fetched from the network. It binds `127.0.0.1` only and refuses requests whose `Host` or `Origin` is not its own, so neither other machines nor other web pages can reach it.

- **Changes**: every active change with its stage, task progress, artifact state, stale and overlap warnings; each change lists its `proposal.md`, `design.md`, `tasks.md` and delta specs.
- **Specs**: `specs/<capability>/spec.md` with its requirements; a `<!-- via: ... -->` marker links back to the archived change that produced the requirement.
- **Archive**: archived and abandoned changes, read-only.
- **Scratch**: `.my-flow/ask/`, `.my-flow/verify/`, `.my-flow/interviews/`, read-only.

Pages update live over Server-Sent Events whenever a file under `specs/`, `changes/` or `.my-flow/` changes, so a task ticked in the terminal shows up in the browser without a reload. Markdown under `specs/` and under an active `changes/<name>/` can be edited in the page. A save is refused when the file changed on disk since it was loaded; the page then shows the newer content and offers Reload or Overwrite. The file's line endings are preserved. Editing is meant for the gaps between stages, while no agent is writing.

- **Theme**: the theme dropdown in the sidebar overrides the system colour scheme; the choice is kept in the browser.
- **Execute lock**: while the current change is at stage `execute`, every save is refused (HTTP 423) and the editor states the reason instead of offering Save, because an agent is writing. The lock lifts as soon as `spec stage` moves the change on.
- **Diff**: when the project root is a git work tree, a `Diff` entry lists the working tree's changes against `HEAD` (staged, unstaged and untracked) as a tree or a flat list and renders the selected file's patch, read-only. It refreshes itself only for edits under `specs/`, `changes/` and `.my-flow/`; use its Refresh button after edits elsewhere. Without git the entry is absent. The most recently modified file is marked, and `j` / `k` move between files while `.` jumps to that file.

`start` detaches the server and records it in `.my-flow/state/dashboard.json`; `stop` confirms that the recorded process is the dashboard (alive, and answering `/api/health` with the same pid and root) before terminating it, and reclaims a stale entry without signalling anything. The skill `/my-flow:dashboard start | stop | status` (Codex: `$my-flow-dashboard`) wraps the same commands.

## The intent layer

```
specs/<capability>/spec.md                 current truth: Requirement + Scenario (WHEN / THEN)
changes/<name>/proposal.md                 why, what, Non-Goals, Decision Boundaries
changes/<name>/design.md                   how; MUST contain ## Do-Not-Touch and ## Rebuild / Re-run After Change
changes/<name>/tasks.md                    ordered checklist; checkboxes are the only progress ledger
changes/<name>/specs/<capability>/spec.md  delta: ## ADDED | MODIFIED | REMOVED Requirements
changes/archive/<date>-<name>/             archived changes (deltas merged into specs/)
changes/.templates/                        templates used by `spec new`
```

Spec format:

```markdown
# <capability> Specification

## Purpose
One paragraph.

## Requirements

### Requirement: <name>
The system SHALL ...

#### Scenario: <name>
- **WHEN** <condition>
- **THEN** <expected outcome>
```

Rules: every requirement has at least one scenario; scenarios use exactly four hashes; delta files place full requirement blocks under `## ADDED Requirements`, `## MODIFIED Requirements` (full replacement), or `## REMOVED Requirements`. Write specs only for behavior a change adds or modifies; `specs/` fills in as changes are archived.

The two required `design.md` sections exist because autonomous loops make a wrong direction expensive: `Do-Not-Touch` names the modules the change must not modify, and `Rebuild / Re-run After Change` names what must be regenerated, rebuilt, cooked, or re-run after each edit (project files, build targets, caches, test suites). `mf-verify` checks both.

`--simple` projects use one `docs/changes/<name>.md` with the same sections instead.

## Repository layout and single-source authoring

```
src/            single source of truth (English): core/core.md, skills/*.md, agents/*.md, rules/*.md
scripts/        build / install / init / spec / ask / models / dashboard / cli; scripts/lib/ shared helpers (spawn, intent, models)
hooks/          the two Node hooks + the Codex PowerShell shim
templates/      project blocks (CLAUDE.md / AGENTS.md), change templates, specs README, simple-mode file
skills/ agents/ .claude-plugin/plugin.json   generated: Claude plugin surface
codex/          generated: Codex skills, agent TOMLs, AGENTS.md block, hooks template
claude/         generated: the block installed into ~/.claude/CLAUDE.md
```

Edit `src/`, then run `node scripts/build.mjs`. Generated files are committed so `claude --plugin-dir` needs no build step; `node scripts/build.mjs --check` fails when they drift. `npm test` runs the built-in `node --test` suite for `spec.mjs` and the Stop hook; it needs no dependencies.

Source conventions:

- `{{ARGS}}` → Claude `$ARGUMENTS` / Codex `{{ARGUMENTS}}`
- `{{CALL:mf-plan}}` → Claude `/my-flow:mf-plan` / Codex `$my-flow-mf-plan`
- `<!-- MY-FLOW:CLAUDE --> … <!-- /MY-FLOW:CLAUDE -->` is kept only in the Claude rendering; `CODEX` likewise
- tool allow-lists per skill and the per-agent model (`inherit`), Codex reasoning effort and sandbox live in `manifest.json`
- `src/rules/*.md` are rule fragments (coding style, testing, git) you can paste into a project's `CLAUDE.md` / `AGENTS.md`; they are not installed automatically

## Installing into Codex

```bash
node scripts/install.mjs codex --dry-run   # see what would change
node scripts/install.mjs codex             # backup, then skills, agents, shim, hooks.json, trusted hashes, AGENTS.md block
node scripts/install.mjs --uninstall codex # reverse
```

If Codex still asks you to trust the hooks, approve them once in `/hooks` (this happens when the upstream hash algorithm changes).

If oh-my-codex is installed, remove it first, in this order:

1. Back up `~/.codex/{config.toml,hooks.json,AGENTS.md,hooks,skills,agents,prompts}`.
2. `omx uninstall --dry-run`, review, then `omx uninstall`.
3. Check `config.toml` for leftovers: the `--previous-notify …notify-hook.js` pair in `notify`, `developer_instructions` mentioning oh-my-codex, `USE_OMX_EXPLORE_CMD` under `[shell_environment_policy.set]`. Keep `[features] hooks / goals / multi_agent = true`.
4. `npm uninstall -g oh-my-codex`.
5. `node scripts/install.mjs codex`.

The installer skips any `~/.codex/agents/<name>.toml` it did not create, so agents left behind by another tool are never overwritten.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `ask codex` fails with "model requires a newer version of Codex" | The model in `~/.codex/config.toml` is newer than the CLI. Run `codex update`, or pass `--model gpt-5.5` (or set `MY_FLOW_CODEX_MODEL`) |
| `ask codex` fails with `EINVAL` | Fixed in `scripts/lib/spawn.mjs`: `.cmd` shims on Windows must go through a shell. Make sure you run the current version |
| `/my-flow:learn` is not listed by the model | Intended. It has `disable-model-invocation`; type it yourself |
| The Stop hook keeps blocking | It only blocks when the last message claims completion **and** either the diff has fake-completion markers or the current change is in stage `execute` with unticked tasks. Fix the markers, finish or block the tasks, or run `spec stage <name> done`. Bypass with `MY_FLOW_SKIP_HOOKS=completion-guard` or `execute-guard` |
| The execute-guard never fires, or fires for an old change | It reads `.my-flow/state/current-change.json` and ignores it once `updated` is older than 12 h. Run `spec stage <name> execute` to refresh it, or `spec stage <name> done` to release it |
| `spec archive` refuses | All boxes must be ticked and a report containing `Verdict: PASS` must exist under `.my-flow/verify/`. Run `mf-verify` first, or use `--force` and say so |
| Codex asks to trust the hooks | Approve once in `/hooks`; the trusted hash format may have changed upstream |
| Split-pane teams on Windows | Not supported by Claude Code; teams run in-process. Do not ask for tmux panes |
| The check never completes under Codex, or `check start` never appears | Run `schtasks /query /tn my-flow-models-check`; if the task is missing, or `node scripts/cli.mjs models status` shows the launcher root or node as not existing (the checkout moved or Node was upgraded), re-run `node scripts/install.mjs claude` or `codex` to re-register it. Under Codex, also make sure the my-flow hooks are trusted once in `/hooks` |
| Subagents run an unexpected model | Run `node scripts/cli.mjs models status`: it shows the override (if any) and the `model:` / effort values read back from the installed agent files. `models reset` restores the inherit baseline; `models.log` under `~/.my-flow/` records every check and analysis. A development checkout (`claude --plugin-dir`) is never rewritten, only the installed plugin cache |

## License

MIT

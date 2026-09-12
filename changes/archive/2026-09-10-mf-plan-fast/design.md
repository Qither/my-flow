# PLAN-DR

## Principles

1. **The fast lane is a different amount of review, not a different artifact.** `design.md`,
   `tasks.md` and the optional delta specs keep the exact shape the full mode produces, because
   four consumers already read them: `spec validate` (`scripts/lib/intent.mjs:227-235`),
   `execute` (`src/skills/execute.md:14-22`), `mf-verify`, and `spec archive`. The only visible
   difference inside the artifacts is one marker line and one word in the handoff.
2. **Text is the whole implementation.** This change edits three source documents under `src/`
   plus eight READMEs. `scripts/build.mjs` renders them (`:74-95` for skills, `:130-140` for the
   core block); no script, hook, template or agent prompt gains a code path. If a task wants to
   touch `scripts/` or `hooks/`, the design is wrong.
3. **One list, referenced twice.** The high-risk categories already exist as prose in two
   places (`src/skills/mf-plan.md:21-23` auto-enables `--deliberate`, `src/core/core.md:31` says
   never skip mf-plan). The guard must not introduce a third, drifting copy: name the list once
   in the skill and point both `--deliberate` and the `--fast` guard at it.
4. **The user chooses the fast lane; the model may only offer it.** A model that can pick
   `--fast` on its own has removed the review from the flow. The skill text states this as a
   rule, and the refusal path proves it cannot be argued around.
5. **Every claim about a run is observable in a file or in the transcript.** For the three real
   runs the evidence is fixed in advance: the presence of `Plan mode: fast` and the absence of a
   `# PLAN-DR` heading in `design.md`, the number and type of subagents that appeared, the
   `stage` value in `.my-flow/state/current-change.json`, and the absence of the string
   `Paste this` in the transcript.

## Decision Drivers

1. **Downstream compatibility** (proposal, What Changes 1 and Success Criteria 2). `spec validate`
   requires only the two sections (`scripts/lib/intent.mjs:232-235`), but `execute` and
   `mf-verify` read the whole file, and `test/markdown.test.mjs:67` pins the rendered form of the
   *templates*. Anything that changes the template or the required section set breaks a test or a
   consumer, so the marker has to be plain body text.
2. **The `/goal` stop is the only interactive stop in `execute`** (`src/skills/execute.md:36-46`).
   `--go` exists to remove exactly that stop and nothing else, and the Stop-hook execute-guard
   (`hooks/completion-guard.mjs:97`, armed by stage `execute`) has to stay armed to compensate.
3. **The rendered `{{CALL:...}}` token is printable text, but on Claude the execute skill can
   still be loaded mid-turn.** `{{CALL:execute}}` renders to `/my-flow:execute` (Claude) or
   `$my-flow-execute` (Codex) (`scripts/build.mjs:63`), which is a reference and not an
   invocation. On Claude the Skill tool does invoke it (`my-flow:execute` is model-invocable;
   only `learn` carries `disable-model-invocation`, `manifest.json:24-26`), so the task loop and
   the final gate arrive as loaded text instead of being recalled from memory. On Codex the
   hand-over stays by reference.

## Viable Options

### A. How `--go` hands over to the execute flow

- **A1 (chosen). The fast lane continues in the same conversation, running the execute skill's
  own text.** After the handoff, `mf-plan` runs `spec stage <name> execute` and then, on Claude,
  invokes `my-flow:execute <name>` through the Skill tool and follows the loaded text with the
  section 2 goal stop skipped (Load step 4 is the stage call just made). On Codex the same
  hand-over is by reference: follow Load steps 1-3, the task loop and the final gate of
  `$my-flow-execute`, with `get_goal` / `create_goal` running normally. Either way the task loop
  and the final gate come from `execute.md`, so a later edit there cannot drift.
- **A2. Copy the task loop and final gate into `mf-plan.md`, or paraphrase them from memory.**
  *Rejected.* Two copies of the final gate is exactly the drift the working agreement forbids,
  `mf-verify` quotes the gate order from one place, and a paraphrase would breach the proposal's
  "everything else in `execute` is unchanged".
- **A3. Print `/my-flow:execute <name>` and stop.** *Rejected.* That is today's behavior; the
  proposal asks for the opposite ("continues directly into the execute flow").
- **A4. Spawn a subagent to execute the change.** *Rejected.* The subagent would own the ledger
  and the goal, breaking "one loop authority per session" and the writer/verifier separation.

### B. How the execute flow learns it was entered with `--go`

- **B1 (chosen). It is the same conversation, so the fact is in context; the canonical rule
  lives in `execute.md` section 2 and the fast lane prints one handover line.** The clause sits
  next to the existing "skip the goal" sentence (`src/skills/execute.md:45`), which is the
  sentence it generalizes. The state file is written by the ordinary `spec stage <name> execute`
  call, so the guard is armed with no new field.
- **B2. Add a flag to `.my-flow/state/current-change.json` (e.g. `entered_via: "go"`).** *Rejected.*
  It requires a `scripts/spec.mjs` change, which the proposal's non-goals forbid, and the hook
  would have to learn a field it never reads.
- **B3. Pass `--go` through as an execute flag (`execute <name> --go`).** *Rejected.* It advertises
  a flag the user should never type: `--go` is meaningful only as "do not stop between planning
  and executing", which cannot happen when the user is the one invoking `execute`.

### C. Where the `Plan mode: fast` marker lives

- **C1 (chosen). A body line written by the fast lane as the first line under `## Context` in
  `design.md`; `templates/change/design.md` is not touched; absence of the line means full mode.**
  `test/markdown.test.mjs:67` asserts the golden render of the template, and every existing change
  and archived change would otherwise have to grow the line.
- **C2. Add a commented placeholder to the template.** *Rejected.* It changes the golden render
  test and adds a section to `spec new` output that the full mode must then remember to delete.
- **C3. Frontmatter or a new `## Plan mode` section in `design.md`.** *Rejected.* `design.md` has
  no frontmatter convention, and a new heading widens the "Required content" contract that
  `mf-verify` and the dashboard both read.

# design.md

## Context

`mf-plan` today always runs planner -> architect -> critic in sequence, up to three rounds
(`src/skills/mf-plan.md:30-47`), with the delegation mechanics per CLI at `:49-57`. The only
cheaper option in the flow is the stage table's first row (`src/core/core.md:28`), which produces
no artifacts at all. This change adds a third setting between them.

Everything in this repository is single-source: `src/skills/*.md` and `src/core/core.md` are
rendered by `node scripts/build.mjs` into `skills/<name>/SKILL.md`,
`codex/skills/my-flow-<name>/SKILL.md`, `claude/CLAUDE.block.md` and `codex/AGENTS.block.md`
(`scripts/build.mjs:74-95`, `:130-140`). Generated files are committed, and
`test/models.test.mjs:643` runs `build.mjs --check`, so a source edit without a build is a red
test. `{{ARGS}}`, `{{CALL:name}}` and the `<!-- MY-FLOW:CLAUDE -->` / `<!-- MY-FLOW:CODEX -->`
blocks are the only templating available (`scripts/build.mjs:60-70`).

Two facts constrain the shape of `--go`. First, the rendered `{{CALL:execute}}` token is only a
reference, so on Claude the execute text has to be loaded deliberately through the Skill tool
(`my-flow:execute` is model-invocable), while on Codex the hand-over stays by reference. Second,
the interactive stop in `execute` is Claude-only (`src/skills/execute.md:36-46`); the Codex branch
(`:64-72`) creates the goal itself with no user interaction. `allowed-tools` in a skill
frontmatter only pre-approves tools for that turn (it does not restrict the tool set), so a
`--go` run needs no `manifest.json` change; commands outside `Bash(node:*)` / `Bash(git log:*)` /
`Bash(git status:*)` simply prompt as they normally would.

## Goals / Non-Goals

**Goals:**

- `mf-plan --fast <name | text>` produces `design.md`, `tasks.md` and any delta specs from the
  main conversation, reviewed by exactly one `critic` pass, with no planner and no architect.
- A guard refuses `--fast` for the high-risk categories, states why in one line, and continues in
  full mode.
- `mf-plan --fast --go` continues straight into the execute flow for the same change, skipping the
  Claude `/goal` stop and nothing else.
- The stage table, the skill table and the built-in comparison document the fast lane in all eight
  READMEs and in the rendered core block for both CLIs.

**Non-Goals:**

- No change to the planner/architect/critic loop, to the agent prompts under `src/agents/`, or to
  `mf-verify`.
- No change to `scripts/`, `hooks/`, `templates/`, or `manifest.json`.
- No second review round, no additional subagent, and no model-selected `--fast`.
- No new spec or task-format rules: `tasks.md` stays the only ledger.

## Decisions

**D1. `--go` runs the execute flow in the same conversation from the execute skill's own text
(option A1).** `src/skills/mf-plan.md` gains a `## Continue into execute (--go)` section whose
shared prose runs `{{CALL:spec}} stage <name> execute`, prints the execute goal statement once as
a standing instruction for the rest of the run (without stopping, so the wording stays in
context), and states that `--team` and `--worktree` are unavailable here: if the user wants
either, the lane stops after the handoff and points at `{{CALL:execute}} <name>`. The mechanism
then differs per CLI:

- `<!-- MY-FLOW:CLAUDE -->`: invoke `my-flow:execute <name>` with the Skill tool, then follow the
  loaded text with the section 2 goal stop skipped per D2 (Load step 4 is the stage call just
  made). Loading it is what keeps the task loop and the final gate the ones `execute.md` defines.
- `<!-- MY-FLOW:CODEX -->`: follow `$my-flow-execute` by reference, Load steps 1-3, then the task
  loop, then the final gate, with `get_goal` / `create_goal` running normally.

Both branches end with execute's Run report block.

**D2. The skip-the-goal clause lives in `execute.md` section 2, inside the CLAUDE block
(option B1).** One sentence after the existing "skip the goal" sentence (`src/skills/execute.md:45`):
entering from `mf-plan --fast --go` in the same conversation counts as the user declining the
goal, so the print-and-stop is skipped and task 1 starts immediately; the stage written in step
1.4 keeps the Stop-hook backstop armed (`hooks/completion-guard.mjs:97` fires only while the
stage is `execute` and the state is fresh). The clause has to live in `execute.md` because the
Claude hand-over loads that file's text: a rule stated only in `mf-plan.md` would be contradicted
by the text the Skill tool then loads. The CODEX block (`:64-72`) is untouched: on Codex `--go`
still calls `get_goal` / `create_goal`, because that path needs no user interaction. The
`mf-plan` side mirrors this in its own CLAUDE / CODEX blocks so the two documents cannot be read
apart.

**D3. One high-risk list, named once.** `src/skills/mf-plan.md` gains a short
`## High-risk categories` section holding the single list: auth, migrations, destructive
operations, public API changes, build config or shader pipeline changes, engine modules. The
`--deliberate` input line (`:21-23`) drops its inline copy and references the section; the
`--fast` guard references the same section. Consequence to accept: `--deliberate` now
auto-enables for "engine modules" too, which the stage table (`src/core/core.md:31`) already
treats as high-risk. Detection stays a judgement call on the proposal text and the paths it
names, exactly as it is today; the change adds no keyword matcher. The single list couples the two
flags on purpose: adding or removing a category moves the `--fast` veto and the `--deliberate`
auto-enable together, which is the property that keeps them from drifting, and is the thing to
remember when a future change edits the list.

**D4. `Plan mode: fast` is body text in `design.md`, written by the fast lane (option C1).** It is
the first line under `## Context`, in the form `Plan mode: fast (one critic pass, no architect).`
No template change, no `spec validate` change, and the full mode keeps writing no marker at all,
so absence means full.

**D5. `argument-hint` grows; `manifest.json` does not change.** The hint becomes
`"<change-name | free text> [--deliberate] [--fast [--go]]"`. `mf-plan` keeps its current
`allowed-tools` (`manifest.json:11-13`): fast mode uses `Read`, `Grep`, `Glob`, `Write`, `Edit`,
`Bash(node:*)` and one `Agent` call, all already listed, and `allowed-tools` pre-approves rather
than restricts, so a `--go` run can still call `npm test` under the normal permission rules.
Adding a bare `Bash` entry was rejected: it would pre-approve arbitrary shell for a skill whose
first line says it never edits source files.

**D6. Handoff wording.** The existing Handoff block (`:73-80`) keeps its shape; the `Review:`
field becomes `fast (critic OKAY, no architect)` or `fast (critic REJECT-fixed, no architect)` in
fast mode, and a `Remaining findings:` line is added only when a critic finding was left unfixed.
With `--go` the handoff ends with one line naming the hand-over (`Continuing into execute (--go):
goal stop skipped, execute-guard armed.`) so the transcript records why no `/goal` was requested.

**D7. Flag conflicts get one refusal vocabulary.** `--go` without `--fast` is refused in one line
and planning continues in full mode. `--fast` together with `--deliberate` is refused the same
way and with the same wording as the high-risk guard: `--deliberate` wins, because a pre-mortem
and a test plan are the opposite of a single-context single-critic pass.

**D8. No `## File Ownership`.** All edits sit in three source documents and eight READMEs with
overlapping review needs; there are no two disjoint groups, so execution is single-owner and
`--team` does not apply.

## Risks / Trade-offs

- **The fast lane's quality rests on one critic pass.** Accepted by the proposal. Mitigation
  inside the text: the guard, and the rule that a REJECT that could not be fixed in one pass is
  listed in the handoff rather than hidden.
- **`--deliberate` widens slightly (D3).** The alternative was two lists that drift. The widening
  only adds a pre-mortem and a test plan to a category the working agreement already calls
  high-risk.
- **`--go` skips the only interactive checkpoint before edits begin.** The Stop-hook backstop is
  armed (stage `execute`), and the flag is opt-in per invocation, never sticky.
- **Two documents must agree** (`mf-plan.md` and `execute.md`). Task 2.1's verification greps both
  files for the same phrase to keep them in step.
- **The eight READMEs drift** if a translation is skipped. Task 3.3's verification is a loop over
  `README.*.md` so a missed file fails the check, not a review.
- **The working tree is already dirty with the uncommitted `agent-model-routing` work** (all four
  `agents/*.md`, the four `codex/agents/*.toml`, `manifest.json`, `scripts/`, `test/models.test.mjs`,
  the eight READMEs), and `changes/` and `specs/` are untracked. `execute` step 1.3 will report
  this; it is pre-existing, not this change. Every task in group 5 and 6 therefore verifies with
  named paths and greps instead of a clean `git status`.
- **A real `/my-flow:mf-plan --fast` invocation needs a session started after the plugin cache was
  refreshed.** The run-verification tasks therefore state which form was used: the native skill
  invocation in a fresh session, or following the installed `SKILL.md` text verbatim in this one.

## Do-Not-Touch

- `scripts/` (all of it, `spec.mjs`, `build.mjs`, `install.mjs`, `lib/`), `hooks/`, `templates/`,
  `web/`, `test/` fixtures and assertions, `package.json`, `manifest.json`.
- `src/agents/` (planner, architect, critic, verifier prompts) and `src/rules/`.
- `src/skills/mf-verify.md`, `src/skills/spec.md`, `src/skills/interview.md`,
  `src/skills/mf-audit.md`, `src/skills/ask.md`, `src/skills/learn.md`,
  `src/skills/dashboard.md`.
- `specs/` (no capability spec is modified; the delta spec under `changes/mf-plan-fast/specs/`
  is merged only by `spec archive`).
- `changes/archive/`, `changes/dashboard-design-parity/`, and any other change directory.
- Generated files are written only by `node scripts/build.mjs`, never by hand:
  `skills/`, `codex/`, `claude/`, `agents/`, `.claude-plugin/plugin.json`.
- The probe change of group 5 writes nothing outside `changes/fast-lane-probe/` and `.my-flow/`.

## Rebuild / Re-run After Change

1. After any edit under `src/`: `node scripts/build.mjs`, then `node scripts/build.mjs --check`
   (must exit 0; `test/models.test.mjs:643` runs it too).
2. After any edit at all: `npm test` (`node --test` over the six suites in `package.json`).
3. Before the group 5 real runs, so the runs use the new text: `node scripts/install.mjs codex`
   (copies `codex/skills/my-flow-*` into `~/.codex/skills/`), `node scripts/install.mjs claude`
   (upserts `claude/CLAUDE.block.md` into `~/.claude/CLAUDE.md`, `scripts/install.mjs:164-170`;
   without it the new stage row never reaches the installed working agreement), and a refresh of
   the Claude plugin cache (`claude plugin update my-flow@my-flow`, or run Claude with
   `--plugin-dir` pointed at this checkout). Plugin skills load at session start, so a native
   invocation needs a new session.
4. After touching `changes/mf-plan-fast/`: `node scripts/spec.mjs validate mf-plan-fast`.
5. After the group 5 probe: `node scripts/spec.mjs stage mf-plan-fast execute` to point the state
   file back at this change, because the probe run overwrote
   `.my-flow/state/current-change.json`.

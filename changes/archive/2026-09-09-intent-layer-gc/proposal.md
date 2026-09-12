## Why

The intent layer (`specs/` + `changes/`) is designed to be committed and to outlive any single
session, so it accumulates. Today entropy only grows:

- `changes/` has exactly one exit, `spec archive`, which requires every task ticked and a PASS
  report. Changes that are dropped after `interview`, superseded during `mf-plan`, or paused
  mid-`execute` stay in the active area forever. They blur `spec status`, can leave a stale
  `execute` stage in `.my-flow/state/` that the completion-guard may act on, and can carry
  delta specs that silently overwrite a later change's delta when archived out of order.
- `specs/` is the "current truth" but nothing re-checks it against the code. After repeated
  `MODIFIED` merges a capability can contain requirements that contradict each other, describe
  behavior the code no longer has, or sit in the wrong capability. Each block is structurally
  valid, so `spec validate` passes, and git blame is the only way to find where a requirement
  came from.

Both need a maintenance path that is cheap to run, leaves a record, and feeds its results back
into the normal change flow instead of bypassing it.

## What Changes

1. **Stale detection in `spec status`.** An active change whose tasks are not all ticked and
   whose newest file mtime (recursive over `changes/<name>/`) is older than N days is marked
   `stale` (text: `[stale 23d]`; JSON: `stale: true`, `lastModified`). Default N = 14,
   overridable with `--stale-days <n>` and `MY_FLOW_STALE_DAYS`. `status` also warns when
   `.my-flow/state/current-change.json` points at a change that is stale or missing.
2. **Delta-overlap warning in `spec status` / `spec validate`.** When two or more active
   changes carry a delta for the same `### Requirement:` name in the same capability, report
   the pair. Detection only; no automatic resolution.
3. **`spec abandon <name> [--reason "..."]`.** The third exit for a change. Requires an
   `## Abandoned` section in `proposal.md` with a `**Reason**:` line (`--reason` appends one).
   Moves the directory to `changes/archive/<date>-<name>-abandoned/`, never merges delta specs,
   and sets the state file to `archived` when the change is current. Refuses when every task is
   already ticked (that is an `archive`), unless `--force`.
4. **Provenance marker on merge.** `spec archive` appends `<!-- via: <date>-<name> -->` directly
   under each `### Requirement:` heading it ADDs or MODIFIES into `specs/<cap>/spec.md`
   (replacing any previous marker for that block). `validate` and `mergeDelta` must tolerate the
   marker. This gives every requirement a direct link back to the proposal that produced it,
   which is the precondition for a cheap audit.
5. **New skill `mf-audit <capability|all>`.** A read-only pass, delegated to the `verifier`
   (or `architect`) role, that cross-references `specs/<cap>/spec.md` against `src/` and
   `tests/` and writes `.my-flow/verify/audit-<cap>-<timestamp>.md` listing: requirements
   with no traceable implementation; behavior in code or tests with no requirement; requirements
   that contradict each other; requirements that appear to belong to another capability. The
   report ends with a suggested change name. Fixes are made only through the normal flow:
   `spec new <name>` -> `mf-plan` (REMOVED / MODIFIED / RENAMED deltas) -> `execute` ->
   `mf-verify` -> `archive`. The skill never edits `specs/`.
6. **Audit nudge in `spec status`.** For each capability, count archived changes (by their
   delta specs) since the last archived change named `*-audit-<cap>*`. When the count reaches
   M (default 5, `MY_FLOW_AUDIT_EVERY`), print `audit suggested: <cap> (<count> merges since
   last audit)`. Derived purely from `changes/archive/`; no new state file.
7. **Docs and generated outputs.** Update `src/skills/spec.md`, add `src/skills/mf-audit.md`,
   register it in `manifest.json`, rebuild (`skills/`, `codex/`, `.claude-plugin/plugin.json`),
   update `templates/specs-README.md` and the project CLAUDE.md / AGENTS.md blocks, and the
   spec-helper section of the README translations.

## Non-Goals

- No automatic deletion, compaction, or date-bucketing of `changes/archive/`. It is history.
- Scripts never rewrite requirement or scenario text in `specs/`. The only script-authored
  content in a spec file is the single-line provenance comment.
- No script-side spec-vs-code checking. Judging whether a requirement is still true is the
  audit agent's or a human's job.
- No change to the completion-guard hook's semantics or TTL. `status` may warn about state;
  the hook is untouched.
- No support for simple mode (`docs/changes/<name>.md`) in stale / abandon / audit. Follow-up.
- No new `STAGES` entry. `abandon` reuses `archived` for the state file.
- No automatic `RENAMED` merge (already out of scope for `archive`).
- No new dependencies, no runtime, no external tool.

## Decision Boundaries

The agent decides alone:
- exact default values within these ranges: stale days 7-30, audit-every 3-10;
- text formatting of new `status` rows and warnings, JSON field names;
- how much code `abandon` shares with `archive` (a shared move helper is fine);
- test structure and fixtures in `test/spec.test.mjs` (mtime is set with `utimesSync`);
- whether `mf-audit` delegates to `verifier` or `architect`, and the report template;
- whether delta-overlap detection lives in `status`, `validate`, or both.

Needs the user:
- any change to `archive`'s PASS-report gate or to the `--force` semantics;
- any script write into `specs/` other than the `<!-- via: ... -->` comment;
- adding a stage to `STAGES` or touching `hooks/completion-guard.mjs`;
- dropping item 6 (audit nudge) if it turns out to complicate `status`;
- which README translations to update in this change (all eight, or English + zh-TW first).

## Capabilities

### New Capabilities
- `spec-helper`: observable behavior of `spec.mjs` for `status` (stale, overlap, audit nudge),
  `abandon`, and the provenance marker written by `archive`.
- `mf-audit`: the audit skill's contract - inputs, report location and sections, the rule that
  it never edits `specs/`, and the hand-off to a new change.

### Modified Capabilities
none (this repository has no `specs/` yet; `mf-plan` writes these as ADDED deltas).

## Impact

- `scripts/spec.mjs`: `status`, new `abandon`, `mergeDelta` marker, `validate` tolerance,
  usage line.
- `src/skills/spec.md` (subcommand docs), new `src/skills/mf-audit.md`, `manifest.json`;
  generated: `skills/spec/SKILL.md`, `skills/mf-audit/SKILL.md`, `codex/skills/...`,
  `.claude-plugin/plugin.json`, `codex/AGENTS.block.md` if it lists skills.
- Possibly `src/agents/verifier.md` or `architect.md` for audit-mode guidance.
- `templates/specs-README.md`, `templates/project/CLAUDE.md`, `templates/project/AGENTS.md`.
- `test/spec.test.mjs` (new tests), `test/helpers.mjs` if a mtime helper is needed.
- `README*.md` spec-helper sections.
- Outside this repo, follow-up only: the user's global working agreement (section 3) lists the
  `spec` subcommands and should gain `abandon`, and section 2 should mention `mf-audit`.

## Success Criteria

- `spec status` on a fixture with one change whose files were back-dated 30 days marks it
  stale and a fresh change not; `--stale-days 60` clears the mark; JSON carries the fields.
- `spec status` warns when the state file names a change that is stale or missing.
- Two active changes with the same requirement name in `specs/cap/spec.md` deltas produce an
  overlap warning naming both changes.
- `spec abandon` refuses without a Reason, succeeds with `--reason`, lands in
  `changes/archive/<date>-<name>-abandoned/`, leaves `specs/` byte-identical, and sets state
  to `archived` when the change was current; refuses a fully ticked change without `--force`.
- After `spec archive`, every merged requirement carries exactly one `<!-- via: ... -->` line;
  `spec validate` passes on the result; a later MODIFIED replaces the marker.
- Audit nudge appears after M archived merges into a capability and disappears after an
  `*-audit-<cap>*` change is archived.
- `npm run check` (build in sync) and `npm test` pass.
- `/my-flow:mf-audit <cap>` on `my-flow-sample` writes a report under `.my-flow/verify/`, ends
  with a suggested change name, and `git status` shows no change under `specs/`.
- `skills/spec/SKILL.md`, `templates/specs-README.md`, and the README spec-helper sections
  describe `abandon`, stale, the marker, and `mf-audit`.

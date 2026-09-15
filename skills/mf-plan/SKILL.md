---
name: mf-plan
description: "Risk-based planning for a change with automatic low, medium and high review lanes. Produce design.md and tasks.md, retain full independent review for high-risk work, and never implement during planning."
argument-hint: "<change-name | free text> [--amend] [--deliberate] [--fast [--go]]"
allowed-tools: "Read Grep Glob Bash(git log:*) Bash(git status:*) Bash(node:*) Write Edit Agent"
---

# mf-plan (risk-based planning)

Produce the complete planning artifacts for one change. Planning only: this skill never
edits implementation files or starts execution merely because a lane was selected.

Input: $ARGUMENTS

## Inputs

- A change name: load `changes/<name>/proposal.md`.
- Free text: create the change with `/my-flow:spec new <name>` and write a short proposal
  with Why, What Changes, Non-Goals, Decision Boundaries and Success Criteria. If the
  request is too vague for these sections, suggest /my-flow:interview rather than guessing.
- `--amend <name>`: use `## Amend an existing contract` instead of overwriting the
  approved plan through the new-plan steps.
- `--deliberate`: force the high lane, including a three-scenario pre-mortem and an
  explicit unit/integration/end-to-end/observability test plan.
- `--fast`: an explicit request for medium review. Only the user supplies this flag.
  Automatic medium does not require or invent `--fast`. High risk, uncertainty, a retained
  high lane or `--deliberate` refuses it. Accepted `--fast` is the
  medium lane: record it as `medium`, never as `low`.
- `--go`: requires explicitly supplied and accepted `--fast`. Otherwise report
  `--go requires --fast` or the fast-refusal reason and remain in planning. Automatic
  medium alone never enables execution. A high-risk or deliberate refusal also refuses go.

## High-risk categories

Auth, migrations, destructive operations, public API changes, build configuration or shader
pipeline changes, and engine modules. Judge the proposal and actual paths, not keywords
alone. This is the single category list for both the high lane and the fast refusal.
Uncertain risk also uses high. Use the category keys accepted by the lane CLI, including
`public-api` for a public CLI contract.

## Boundary

Write only under `changes/<name>/` and `.my-flow/`. Preserve every Do-Not-Touch and
Rebuild / Re-run constraint. Ask only when a decision materially changes scope or authority.
Do not silently upgrade a legacy change; follow its explicit migration decision before
using linked-only metadata commands.

## Choose the lane before delegation

1. Read the proposal, relevant files/specs and applicable project instructions. Judge
   `categories`, `paths`, `multiFile` and `uncertain`, and save that evidence as
   `<risk.json>` in scratch. Several explicit files with a clear approach and no high-risk
   category select medium automatically; one reversible known file with explicit acceptance
   selects low. High risk or uncertainty selects high.
2. Run `/my-flow:spec lane select <name> --file <risk.json> [--fast] [--deliberate] [--go]`,
   passing only flags the user supplied. It records nothing and authorizes nothing.
   Preserve the effective recorded lane as a floor and report any refused override.
3. Record the result and rationale with
   `/my-flow:spec lane set <name> --lane <low|medium|high> --reason "<why>" --paths <a,b>`.
   A scope change can escalate review; never silently downgrade it to avoid reviewers.
4. Dispatch only the selected lane below. Do not run the high-lane roles unconditionally.

## Low lane

The main context writes the short plan and explicit acceptance contract. No planning
subagent is required. Preserve all required artifacts and constraints, record the low-risk
reason, complete `## Prepare the review target`, then continue to `## Finish and record approval`. Final verification is still a fresh
independent pass; a low lane does not authorize implementation.

## Medium lane

This lane is selected automatically for clear multi-file work or by accepted `--fast`.

1. Draft in the main context using actual `path:line` evidence. Produce proposal, design,
   tasks, acceptance and applicable delta specs with the same required constraints. No mandatory PLAN-DR
   expansion, drafting planner or architect is needed. For v2, record the lane/reason/paths
   in metadata and a concise `Review lane: medium` context line. Old `Plan mode: fast`
   markers remain readable history, not new approval metadata.
2. Complete `## Prepare the review target`, then give the complete short plan to an independent read-only critic. Require `OKAY | REJECT`,
   simulated tasks and concrete fixes. Bind its result to the reviewed contract digest.
3. On REJECT, fix the draft in the main context and obtain focused critic re-review before
   approval. Supply the previous review, changed blocks and open findings. A fixed draft is
   not approved until the critic returns OKAY for that current text. Repeat the review-target
   preparation after each fix and before re-review.
4. Repeated rejection escalates to the high lane. Count medium and high rounds within the
   same maximum of three review iterations; after two failed medium rounds, use the remaining
   round for full planning. If the budget ends without approval, report the open findings and
   stop at an unapproved handoff. Do not enter execute.

## High lane

Use this lane for high risk, uncertainty, retained high review or explicit `--deliberate`.

1. Delegate the draft to the planner. Require a PLAN-DR header (3-5 principles, top three
   decision drivers, at least two viable options or explicit invalidation), complete proposal,
   design, tasks, acceptance and applicable delta specs, three-scenario pre-mortem and the
   explicit test plan. Record the planner's actual DRAFT against its completed target.
2. Complete `## Prepare the review target`, then have an independent read-only architect review the draft: `CLEAR | WATCH | BLOCK`,
   path/line evidence, antithesis, tension and required changes.
3. Have an independent read-only critic review the same draft and architect result:
   `OKAY | REJECT`, simulated tasks and concrete fixes. Run these roles sequentially.
4. On BLOCK or REJECT, make fixes through the planner, repeat review-target preparation,
   and repeat the independent reviews against the resulting target.
   Use at most three review iterations total, including any preceding medium rounds.
   After two failed iterations, offer /my-flow:ask as a tie-breaker. Unresolved findings
   remain unapproved; do not claim consensus or continue into execute.

## Prepare the review target

Before any approval review, finish proposal, design, tasks, acceptance and applicable delta
requirements with WHEN/THEN scenarios. Capture any required spec bases using the documented
spec commands. Run `/my-flow:spec validate <name>` and fix every error. Then build
`/my-flow:spec context <name>` and capture the current contract digest for the reviewers.
Do not change contract text between the selected reviews and recording their approval.
If preparation changes the high-lane planner's target, return it to the planner for a fresh
DRAFT before architect and critic review. Any later contract edit returns to this preparation
step and the selected lane's reviews; approval never carries across a changed digest.

## Delegation and context

Build `/my-flow:spec context <name>` for the planning handoff. For repeat reviews, use
`--since <digest>` and include the previous review, changed blocks and unresolved findings.
Reviewers can expand source reads; packets are derived context, not replacement authority.

Use ordinary foreground Agent calls with `subagent_type` set to the selected
`my-flow:planner`, `my-flow:architect` or `my-flow:critic`. Omit `name`, `team_name`
and `run_in_background`: named teammate dispatch must not replace a configured role.
Medium dispatches only the critic; high dispatches planner, architect and critic in order.

## Finish and record approval

1. Confirm review-target preparation and the selected reviews are complete for the current
   digest. If any contract change is needed, return to preparation and re-review first.
2. Record each actual review with
   `/my-flow:spec review record <name> --file <review.json>`: include role, verdict,
   actorId, writerActorId, contractDigest and the actual sourceRef. Do not invent reviews.
   Any edit after review changes the digest and requires the appropriate re-review.
3. `/my-flow:spec lane status <name>` must confirm approval of the current contract:
   low has its explicit acceptance and rationale; medium requires critic OKAY; high requires
   planner DRAFT, architect CLEAR/WATCH without blocking findings, and critic OKAY.
4. Run `/my-flow:spec stage <name> mf-plan` with the existing session identity, then print
   the handoff. Planning must not create an execute lease.

## Amend an existing contract

Read the existing contract, constraints, findings and `/my-flow:spec amend status <name>`.
Use the staged amendment schema documented by /my-flow:spec; never replace approved canonical
text directly while execution is continuing.

Prepare the old/candidate references, cause and affected task/acceptance/design IDs, then run
`/my-flow:spec amend propose <name> --file <candidate.json>`. Locator-only corrections keep
executor authority; equivalent-check corrections require independent equivalence review;
scope/guarantee changes require the user's explicit decision unless already authorized.
A changed trust boundary returns to full review.

Record the review with `/my-flow:spec review record <name> --amend A-<id> --file <review.json>`.
Only then use `/my-flow:spec amend apply <name> --id A-<id>`; cancellation uses the documented
cancel command. While review is pending, the approved contract remains active for unaffected
tasks, and affected tasks and descendants stay held. Preserve old versions and invalidated
evidence. Repeated-cause findings trigger design review before a third patch, not a weaker check.

## Continue into execute (--go)

Continue only after the current plan is approved and the handoff is printed, and only when
the user's explicit `--fast --go` was accepted. A high/deliberate refusal or automatic medium
selection does not qualify. The final recorded lane must still be medium; escalation
invalidates an earlier fast/go selection. `--team` and `--worktree` remain unavailable through go.

Invoke `my-flow:execute <name>` with the Skill tool. Follow its loaded goal handoff:
print the `/goal` statement once and wait for the user's response. Never impersonate that
response. Record: `Continuing into execute (--go): goal handoff applies.`

## Required content

Design sections: `## Context`, `## Goals / Non-Goals`, `## Decisions`, `## Risks / Trade-offs`,
`## Do-Not-Touch`, `## Rebuild / Re-run After Change`, and `## File Ownership` only for
explicitly planned team execution. Linked plans also fill `acceptance.md` with stable criterion
IDs, required flags, evidence modes and concrete checks.
Tasks use `- [ ] N.M <action> and verify <observable result>`; linked tasks retain their
stable IDs, prerequisites, acceptance and design references.

## Handoff (always the last thing you print)

```
## Handoff
Change: changes/<name>   Review lane: low|medium|high   Approval: approved|unapproved
Reviews: <actual roles, verdicts and round>
Remaining findings: <none or concrete unresolved findings>
Rebuild / Re-run: <the list from design.md>
Next: /my-flow:execute <name> | resolve planning findings
```

Use the execute next step only for an approved plan. Without valid explicit fast/go, stop
after the handoff and wait for execution authorization.

# Git workflow (my-flow default)

- Commit per task when practical: `<type>(<change>): <task id> <summary>` with types
  feat, fix, refactor, docs, test, chore, perf, ci.
- Commit `openspec/` together with the code it describes.
- Never commit `.my-flow/`.
- Do risky changes in a worktree; never rewrite shared history.
- Before a PR: `git diff <base>...HEAD`, re-read `design.md` Do-Not-Touch, confirm every
  `tasks.md` box is ticked and a PASS report exists.

## Project-specific git rules

<!-- Branch naming, protected branches, required checks, reviewers. -->

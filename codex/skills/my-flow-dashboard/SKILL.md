---
name: my-flow-dashboard
description: "Start, stop or check the local my-flow web dashboard - a zero-dependency, loopback-only page over specs/, changes/ and .my-flow/ with live updates and guarded markdown editing between stages. Use when the user wants to watch a change progress in a browser, edit a proposal or spec outside the terminal, or close the dashboard again."
argument-hint: "start [--port N] | stop | status"
---

# Dashboard

Input: {{ARGUMENTS}}

All mechanics are in the `dashboard.mjs` script; run it and relay its output. The dashboard is
optional: no skill, hook or agent depends on it, and the flow is unchanged whether it runs or
not. Default is `start`.

```
node "{{MYFLOW_ROOT}}/scripts/dashboard.mjs" <start|stop|status> [--port N] [--root dir] [--json]
```

`--root` defaults to the current directory; pass the project root explicitly when the session
runs elsewhere.

## start [--port N]

Detaches a server on `127.0.0.1:4321` (or `--port`), waits for it to record itself in
`.my-flow/state/dashboard.json`, and prints the URL. Relay that URL to the user; the process
keeps running after this command returns. Exit 1 means one of:
- `already running at <url>`: relay the URL, do not start another.
- `port <N> is already in use` / `failed to start on port <N>`: offer `start --port <other>`.
- `recorded on port <N> ... does not answer`: run `stop` first, then `start` again.

The page shows four views: Changes (stage, task progress, artifact state, stale and overlap
warnings, per-change files), Specs (requirements with `via` links back to the archived change),
Archive (read-only) and Scratch (`.my-flow/ask|verify|interviews`, read-only). Files under
`specs/` and active `changes/<name>/` can be edited in the browser; a save is refused when the
file changed on disk since it was loaded, and the user chooses Reload or Overwrite. The server
binds loopback only and serves no external resource.

Three more things the page does:
- **Theme**: the theme dropdown in the sidebar overrides the system colour scheme; the choice
  is kept in the browser.
- **Execute lock**: while `.my-flow/state/current-change.json` records stage `execute`, every
  save is refused (HTTP 423) and the editor shows the reason instead of Save, because an agent
  is writing. The lock lifts as soon as `spec stage` moves the change on; nothing to reset.
- **Diff**: when the project root is a git work tree, a `Diff` entry lists the working tree's
  changes against `HEAD` (staged, unstaged and untracked) as a tree or a flat list and renders
  the selected file's patch, read-only. It refreshes itself for edits under `specs/`,
  `changes/` and `.my-flow/`; use its Refresh button after edits elsewhere. Without git the
  entry is absent. The most recently modified file is marked, and `j` / `k` move between files
  while `.` jumps to that file.

## stop

Reads the state file, confirms the recorded process is alive and answers `/api/health` with the
same pid and root, then terminates it and removes the file. A stale entry (dead pid, or a port
answering for a different dashboard) is removed without signalling anything; a recorded server
that does not answer is reported and the file is kept so `stop` can be retried. Use this
whenever the user asks to close the dashboard, and before the session ends if you started it.

## status

Reports `running at <url>`, `not running`, `removed stale dashboard state`, or `did not answer`
(exit 1). Never edit `.my-flow/state/dashboard.json` by hand; `stop` and `status` reclaim it.

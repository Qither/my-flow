# Manual UI observation — linked-evidence-workflow (AC-01, AC-02)

Recorded 2026-09-15 against the running dashboard at `http://127.0.0.1:4321/`, change view
`#/changes/linked-evidence-workflow`, through the my-flow browser harness.

## The harness blocker was narrower than it looked

Earlier attempts, and the independent verifier's, reported `Chromium did not report a DevTools port
within 15000 ms` in both headless and headed modes. That is **not** a missing or broken Chromium:
the same open succeeds immediately with `temporary: true`, which uses a throwaway profile directory.

```
browser_open http://127.0.0.1:4321/  headless            -> error: no DevTools port within 15000 ms
browser_open http://127.0.0.1:4321/  headed              -> error: no DevTools port within 15000 ms
browser_open http://127.0.0.1:4321/  headless+temporary  -> allow, tabId t1, title "my-flow dashboard"
```

So the fault is the persistent agent profile under `<MY_FLOW_HOME>/browser/profiles`, not the
browser. That is a defect in the sibling browser-harness repository, which this change's
Do-Not-Touch forbids editing here; it belongs in follow-ups.md against that project.

## What was observed

Viewport as opened: 1264 x 705 CSS px (the harness window; the declared target is 1280px).

**Dark palette** (Theme: Auto (system), resolving to dark) and **light palette** (Theme: Light,
switched through the sidebar listbox) were both read at that width. The two renderings are
identical in layout and differ only in colour, with no clipping or reflow between them.

Against AC-01's stated clause — "At 1280px and 390px, both palettes: title/result are visible
without opening commands; links have target names; no horizontal page overflow":

- **Title and result visible without opening commands** — yes. Each row reads as
  `0.1  Preflight both live hosts  [blocked]` with the observable result on its own line beneath,
  `verify: authentication, goals and independent agents are available`, and the task id in a
  separate detail box (`T-29`). The verification phrase is plain text on the row; nothing has to
  be expanded to read what the task promises.
- **Links have target names** — yes. The breadcrumb reads `changes / linked-evidence-workflow`
  and the change heading links by name rather than by id or URL.
- **No horizontal page overflow** — none at this width, in either palette.
- Readiness is carried by a badge next to the title (`blocked`, `complete`), and the progress
  header reads `28/32 ticked, schema v2`.

## What is still outstanding

- **The 390px narrow-width reading (AC-01, and AC-02's manual mode).** Setting a 390px viewport
  needs `Emulation.setDeviceMetricsOverride`, and `browser_unsafe_cdp` returns
  `approval_required` on every call — an approval gate this session cannot satisfy on its own.
  Either a user approves that CDP call, or a human reads the page at 390px in both palettes.
- **AC-02's keyboard focus, back navigation and SSE-refresh observation** was not attempted here.

Neither of these is a defect in the change; both are observations nobody has been able to make.
T-08 therefore stays held, and V-1 recorded AC-01 and AC-02 as PARTIAL for exactly this reason.

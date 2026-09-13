# Fresh real-host closeout observations — 2026-09-13

These are execution observations, not an independent whole-change verdict.
Machine-readable responses and exact audit lines are in `closeout-host-evidence.json`;
process checks are in `closeout-host-process-checks.json`. They were collected through
actual Claude Code and Codex clients, not a renamed test MCP client.

| Scenario | Claude Code | Codex |
| --- | --- | --- |
| Dashboard open / observe / candidate click / screenshot | allow; change detail visible | allow; change detail visible |
| Password read | empty text, no password disclosure | empty text, no password disclosure |
| Password selector extract | `[masked]` | `[masked]` |
| Injection page | returned as untrusted data; deletion output empty; no instructed action | same |
| Download click without a token | approval_required, download; no token retry | same |
| Fixture download requests | no report.txt/archive.zip request | same shared request log |
| Corrected headed temporary task close | allow, closed=true; next list=no open task | same |
| Corrected close audit | original profile/tempProfile retained; next no-task record has none | same |
| Corrected temporary directory / state | directory absent, no session state files | same |
| Corrected browser processes | no chrome.exe command line matching the unique profile | same |

The password read exposes visible text only and returns an empty string for an input;
extract returns an explicit mask. Neither result includes the fixture's password value.
No approval override seam was enabled for the download checks; the native harness prompt
was requested, and the clients never supplied an approval token. The shared fixture server
recorded no request for either downloadable file.

The initial fresh security runs exposed a genuine close error and leftover temporary
profiles. Those failed observations are retained in the JSON instead of being described
as success. D16 fixes the browser-close path and the successful close call's audit identity.
After the repair, new actual headed runs on both clients returned allow/closed=true and
no-open-task afterward, with matching original audit lines and absent profile directories.
The earlier valid dashboard/masking/injection/download observations remain attached to
their original calls; those operations were not modified by D16. Separate targeted and
full-suite checks cover the final code, and the independent reviewer must assess both.

The original Codex CLI retry attempt was blocked by that CLI's MCP approval policy and made
no harness call. The user then explicitly authorized only browser_open, browser_read and
browser_tabs for one isolated invocation. The successful invocation retained read-only
shell, exposed only those three browser tools, changed no global configuration, and did
not include download or unsafe approvals. Its raw trace is retained separately.

Screenshots: `closeout-claude-dashboard.png`, `closeout-codex-dashboard.png`.
For the earlier real manual grant/revoke sessions, see the two extension-bridge e2e
evidence files and the bounded host evidence report. No toolbar gesture was synthesized.

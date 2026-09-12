# dashboard Specification

## Purpose
The local web dashboard: how the server starts, stops and records itself, what its JSON API
guarantees about parity with the CLI, how it pushes file changes to the browser, what the
guarded save endpoint allows and refuses, that the pages never reach the network, and which
markdown constructs the renderer covers.

## Requirements

### Requirement: Dashboard server lifecycle
<!-- via: 2026-09-09-web-dashboard -->

The system SHALL provide `my-flow dashboard start | stop | status`, serving over HTTP on a
loopback address only, defaulting to `127.0.0.1:4321` and overridable by `--port` and `--root`.
On a successful bind the server SHALL write `.my-flow/state/dashboard.json` containing `pid`,
`host`, `port`, `url`, `root` and `started`, recording the port actually bound. The server SHALL
remove that file on a graceful shutdown. `stop` SHALL confirm the recorded process is both alive
and the dashboard itself before sending any signal, and SHALL treat a state file it cannot
confirm as stale, removing it and signalling nothing. A port already in use SHALL fail loudly
rather than silently binding a different port.

#### Scenario: Starting records the bound port and pid
- **WHEN** the dashboard server starts against a project root
- **THEN** `.my-flow/state/dashboard.json` exists and carries the pid of the server process, the
  port it actually bound, the project root, and an ISO `started` timestamp

#### Scenario: Stopping removes the state file
- **WHEN** `my-flow dashboard stop` runs against a project whose dashboard is running
- **THEN** the server process terminates, the command reports that it stopped, and
  `.my-flow/state/dashboard.json` no longer exists

#### Scenario: A stale pid is reclaimed rather than signalled
- **WHEN** `my-flow dashboard stop` or `status` runs while `.my-flow/state/dashboard.json` names
  a process id that no longer exists, or one that does not answer the health endpoint with the
  same pid and root
- **THEN** the command reports the entry as stale, deletes the state file, and sends no signal
  to that process id

#### Scenario: No state file means not running
- **WHEN** `my-flow dashboard status` runs against a project with no
  `.my-flow/state/dashboard.json`
- **THEN** the command reports that the dashboard is not running and exits 0

#### Scenario: A busy port is reported, not worked around
- **WHEN** the dashboard is started on a port that is already bound
- **THEN** the command exits non-zero naming the port, and no state file is written

### Requirement: Status API parity with the CLI
<!-- via: 2026-09-09-web-dashboard -->

The system SHALL serve `GET /api/status` and `GET /api/validate` returning exactly the objects
that `spec status --json` and `spec validate --json` print for the same project root, with no
added, removed or renamed keys and no wrapping envelope. Both endpoints SHALL derive their
values from the same shared library the CLI uses, so progress counts, artifact state, delta spec
counts, stale marking, overlap warnings and audit nudges cannot diverge between the two
surfaces. Each request SHALL recompute from disk rather than reuse a value cached from an
earlier request.

#### Scenario: The status endpoint matches the CLI byte for byte
- **WHEN** `GET /api/status` is requested for a project and `spec status --json` is run against
  the same project
- **THEN** the parsed response and the parsed CLI output are deeply equal, including the `root`,
  `current`, `changes` and `warnings` fields

#### Scenario: The validate endpoint matches the CLI
- **WHEN** `GET /api/validate` is requested for a project holding a change with a delta spec
- **THEN** the parsed response is deeply equal to the parsed output of `spec validate --json`,
  including the `ok` flag and every per-change `errors` and `warnings` array

#### Scenario: A second request reflects a change made after the first
- **WHEN** a task box is ticked on disk after `GET /api/status` has already been served once,
  and the endpoint is requested again
- **THEN** the second response carries the new ticked count, because the overlap and status data
  are recomputed per request rather than cached for the life of the process

### Requirement: Push update on file change
<!-- via: 2026-09-09-web-dashboard -->

The system SHALL push file-change notifications to connected browsers over a Server-Sent Events
stream at `GET /api/events`, so that a page reflects a change made outside the browser without a
reload. The server SHALL watch `specs/`, `changes/` and `.my-flow/` when they exist, SHALL
coalesce the events of one save into a single notification, and SHALL name the changed paths
relative to the project root. It SHALL NOT notify clients about its own state file. When a
recursive watcher cannot be established the server SHALL fall back to periodic polling rather
than serve a page that never updates.

#### Scenario: Ticking a task box reaches the browser
- **WHEN** a client is connected to `GET /api/events` and `changes/<name>/tasks.md` is modified
  on disk
- **THEN** a `change` event naming `changes/<name>/tasks.md` arrives on the stream within one
  second, and the page updates its progress without a reload

#### Scenario: The dashboard's own state file is not an update
- **WHEN** `.my-flow/state/dashboard.json` is written while a client is connected
- **THEN** no `change` event naming that file is sent

#### Scenario: A connecting client learns which project it is watching
- **WHEN** a client opens `GET /api/events`
- **THEN** the server immediately sends a `hello` event carrying the project root, the port and
  the start timestamp

#### Scenario: Watching degrades instead of failing
- **WHEN** a recursive filesystem watcher cannot be established on this platform
- **THEN** the server continues to serve, falls back to periodic modification-time polling, and
  still emits `change` events for edits under the watched directories

### Requirement: Guarded save endpoint
<!-- via: 2026-09-09-dashboard-theme-lock-diff -->

The system SHALL accept edits only through `POST /api/file`, and SHALL allow a write only when
the target is a `*.md` file that already exists, resolves inside the project root, and lies
either under `specs/` or under an active `changes/<name>/`. Files under `changes/archive/` and
under `.my-flow/` SHALL never be writable. A path that is absolute, that escapes the root once
resolved, or that is not a string SHALL be rejected without touching the filesystem. A write SHALL
additionally be refused while the recorded stage is `execute`, as required by the edit lock, and
that refusal SHALL come after the checks that judge the request itself and before any check that
discloses the target's existence, modification time or content. Reading is governed by a wider
allow-list that also covers `changes/archive/` and the `ask`, `verify` and `interviews` directories
under `.my-flow/`, and a read response SHALL state whether that file is writable and, when a lock
is the reason it is not, why.

#### Scenario: An active change file is saved
- **WHEN** a save is posted for `changes/<name>/proposal.md` of an active change with the
  current modification time, and the recorded stage is not `execute`
- **THEN** the response is successful, the file on disk carries the submitted content, and the
  response returns the new modification time for the next save

#### Scenario: The archive is never writable
- **WHEN** a save is posted for a file under `changes/archive/`
- **THEN** the request is refused as not writable and the file on disk is unchanged

#### Scenario: The scratch directory is never writable
- **WHEN** a save is posted for a file under `.my-flow/ask/`
- **THEN** the request is refused as not writable and the file on disk is unchanged

#### Scenario: A traversing path is refused before any write
- **WHEN** a save is posted with a path containing `..` that would resolve outside the project
  root, or with an absolute path
- **THEN** the request is refused with a bad-path error and no file is created or modified
  anywhere outside the project root

#### Scenario: A non-markdown target is refused
- **WHEN** a save is posted for a file under an active change whose name does not end in `.md`
- **THEN** the request is refused as not writable

#### Scenario: A read-only file is marked as such
- **WHEN** a file under `.my-flow/verify/` is read through the file endpoint
- **THEN** the response succeeds and reports that the file is not writable, and a file outside
  every read allow-list is refused

#### Scenario: A writable target is refused while the run is in progress
- **WHEN** a save is posted for a file that the allow-list would accept, while the recorded stage
  is `execute`
- **THEN** the request is refused as locked rather than written, and the file on disk is unchanged

### Requirement: Modification-time conflict on save
<!-- via: 2026-09-09-web-dashboard -->

The system SHALL refuse a save whose submitted modification time does not match the file's
current modification time on disk, SHALL leave the file untouched, and SHALL return the current
on-disk content together with its modification time so the user can compare. The user SHALL be
able to repeat the save with an explicit force flag, which overwrites regardless of the
mismatch.

#### Scenario: A stale save is refused with the newer content
- **WHEN** a file is changed on disk after the browser loaded it and the browser posts a save
  carrying the older modification time
- **THEN** the save is refused as a modification-time conflict, the response carries the current
  on-disk content and modification time, and the file is byte-identical to what it was before
  the request

#### Scenario: Forcing overwrites the newer content
- **WHEN** the same save is repeated with the force flag set
- **THEN** the response is successful and the file on disk carries the submitted content

### Requirement: Line-ending preservation on save
<!-- via: 2026-09-09-web-dashboard -->

The system SHALL preserve the line-ending style of the file being saved: a file that contains
carriage-return line feeds SHALL keep them, and a file with line feeds only SHALL not gain any.
The system SHALL NOT otherwise alter the submitted content, adding no trailing newline and
trimming nothing.

#### Scenario: A CRLF file stays CRLF
- **WHEN** a file whose lines end in CRLF is saved from the browser, whose textarea submits line
  feeds only
- **THEN** every line of the file on disk still ends in CRLF and no lone line feed is introduced

#### Scenario: An LF file stays LF
- **WHEN** a file whose lines end in LF is saved from the browser
- **THEN** the file on disk contains no carriage return

### Requirement: Offline operation with no external resources
<!-- via: 2026-09-09-web-dashboard -->

The system SHALL serve every asset the pages need from the project itself, with no runtime npm
dependency, no bundler and no external network access. No served HTML, CSS or JavaScript file
SHALL reference a script, stylesheet, font or image over `http://` or `https://`, and the pages
SHALL be fully usable with the network disabled. The server SHALL serve static files only from
its own asset directory, refusing any path that resolves outside it.

#### Scenario: No served file reaches the network
- **WHEN** every static file the dashboard serves is inspected
- **THEN** none of them contains an `http://` or `https://` reference, and `package.json`
  declares no `dependencies`

#### Scenario: The pages work with the network disabled
- **WHEN** the dashboard is opened with the machine's network disabled
- **THEN** all four pages render, navigate and update over the local server exactly as they do
  with the network enabled

#### Scenario: Static serving cannot escape the asset directory
- **WHEN** a request asks for a path that resolves above the dashboard's asset directory,
  whether written literally or percent-encoded
- **THEN** the server responds 404 and serves no file from outside that directory

### Requirement: Markdown rendering subset
<!-- via: 2026-09-09-web-dashboard -->

The system SHALL render the markdown that the my-flow templates and specs use with its own
renderer and no third-party library: headings, paragraphs, unordered and ordered lists, task
checkboxes, bold and inline code, fenced code blocks, pipe tables, horizontal rules, and links
whose target is relative, a fragment, or an `http` or `https` URL. HTML comments SHALL be hidden
from the rendered output, except that a `<!-- via: ... -->` provenance marker SHALL be surfaced
as a link back to the archived change that produced the requirement. Any construct outside this
subset SHALL render as plain text rather than as broken markup. The renderer SHALL escape every
piece of file content before applying markup, so that no file can inject HTML into the page.

#### Scenario: The template subset renders as structure
- **WHEN** a change's `design.md` and `tasks.md` are rendered
- **THEN** headings, bullet lists, fenced code blocks, tables and bold text appear as their
  corresponding elements, and task lines appear as checkboxes marked ticked or unticked to match
  the file

#### Scenario: A provenance marker links to its change
- **WHEN** a requirement in `specs/<capability>/spec.md` carries `<!-- via: <date>-<name> -->`
- **THEN** the rendered requirement shows that provenance as a link to the corresponding entry
  under `changes/archive/`, while every other HTML comment is hidden

#### Scenario: An unsupported construct degrades to text
- **WHEN** a file contains a blockquote or an image, neither of which is in the subset
- **THEN** the line renders as escaped plain text and the surrounding document still renders
  correctly

#### Scenario: File content cannot inject markup
- **WHEN** a file contains a `<script>` tag, a raw ampersand, or a link whose target uses the
  `javascript:`, `data:` or `vbscript:` scheme
- **THEN** the tag and the ampersand appear escaped in the output, and none of those targets
  reaches a link target, because a bare relative target may contain no colon before its first
  slash

### Requirement: Rejection of cross-origin requests
<!-- via: 2026-09-09-web-dashboard -->

Binding to a loopback address SHALL NOT be the only protection on the write path, because any
web page the user visits while the dashboard runs can issue requests to it, and a cross-origin
`POST` carrying a simple content type is delivered without a preflight the browser would block.
The system SHALL therefore reject a request whose `Host` header does not name a loopback address
with the port actually bound, SHALL reject a request carrying an `Origin` header that is not the
server's own origin, SHALL require the JSON content type on the save endpoint, and SHALL cap the
request body at a fixed size. The system SHALL NOT emit any header that grants cross-origin
access.

#### Scenario: A foreign Host header is refused
- **WHEN** a save is posted with a `Host` header naming a domain other than the loopback address
  and bound port, as a rebinding attack would send
- **THEN** the request is refused, and the target file is byte-identical to what it was before

#### Scenario: A simple-request content type is refused
- **WHEN** a save is posted with `content-type: text/plain`, which a browser sends
  cross-origin without a preflight
- **THEN** the request is refused on the content type before the body is read, and the target
  file is unchanged

#### Scenario: A foreign Origin is refused
- **WHEN** a request carries an `Origin` header naming a site other than the dashboard's own
  origin
- **THEN** the request is refused, and no response header granting cross-origin access is sent

#### Scenario: An oversized body is refused
- **WHEN** a request body exceeds the server's fixed size cap
- **THEN** the request is refused as too large and nothing is written

### Requirement: Theme selection independent of the operating system
<!-- via: 2026-09-10-dashboard-design-parity -->

The dashboard SHALL offer a three-state theme control with the values `system`, `light` and
`dark`, defaulting to `system`. The choice SHALL be stored in the browser's local storage under
the key `my-flow.theme` and SHALL be applied before the first paint, so that no reload shows the
wrong palette first. An explicit `light` or `dark` choice SHALL override the operating system's
`prefers-color-scheme` setting in both directions, and `system` SHALL restore following it. The
stylesheet SHALL express this with an attribute on the document root, and every rule that keys
off the dark colour scheme, including the scrollbars, the pressed and open control surface and
the active navigation entry, SHALL follow the same switch. A browser that refuses access to local
storage SHALL still render the page, following the operating system's scheme.

The control SHALL be a custom listbox built from the page's own script with no library: a
trigger button carrying `role="combobox"`, `aria-haspopup="listbox"`, `aria-expanded` and
`aria-controls`, and a popover list carrying `role="listbox"` whose entries carry `role="option"`
and `aria-selected`. Focus SHALL stay on the trigger while the list is open, and the focused entry
SHALL be announced through `aria-activedescendant`. The trigger SHALL show the label of the current
value, and the open list SHALL mark the current value with a check indicator. The keyboard SHALL
work as follows: `ArrowDown`, `ArrowUp`, `Enter`, `Space`, `Home` and `End` on the closed trigger
open the list, `ArrowDown` and `ArrowUp` move the focused entry without wrapping, `Home` and `End`
jump to the first and last entry, typing printable characters focuses the first entry whose label
starts with the typed prefix (a repeated single character cycling through its matches, the prefix
resetting after a short pause), `Enter`, `Space` and `Tab` commit the focused entry, and `Escape`
closes the list without changing the value. A pointer click on the trigger SHALL toggle the list,
a click on an entry SHALL commit it, and a click outside or focus leaving the control SHALL close
it without a change. The decision of which entry is focused, whether the list is open and which
value is committed SHALL be made by a pure function that takes the previous state and the key or
pointer event and returns the next state, so that it can be tested without a document. The
trigger SHALL be excluded from every page-level keyboard shortcut in the same way an input, a
select or a textarea is.

#### Scenario: An explicit choice beats the operating system
- **WHEN** the operating system reports a dark colour scheme and the user selects `light` in the
  theme control
- **THEN** the page renders with the light palette, including the scrollbars, the pressed and open
  control surface and the active navigation entry, and selecting `dark` under an operating system
  reporting light renders the dark palette

#### Scenario: The choice survives a reload without a flash
- **WHEN** a theme has been chosen and the page is reloaded
- **THEN** the page is already rendered in the chosen theme at its first paint, with no
  intermediate frame in the other palette

#### Scenario: Returning to system follows the operating system again
- **WHEN** the user selects `system` after having chosen `light` or `dark`
- **THEN** the stored choice is cleared and the page follows the operating system's colour scheme

#### Scenario: Storage being unavailable is not an error
- **WHEN** the browser denies access to local storage
- **THEN** the page still renders and follows the operating system's colour scheme, and the theme
  control remains usable for the current page

#### Scenario: The listbox is driven from the keyboard
- **WHEN** the trigger has focus with the value `system`, and the user presses `ArrowDown`, then
  `ArrowDown` twice more, then `Home`, then `End`, then `Enter`
- **THEN** the first key opens the list with `system` focused, the next two move the focus to
  `light` and then `dark` and a further `ArrowDown` stays on `dark`, `Home` focuses `system`,
  `End` focuses `dark`, and `Enter` commits `dark`, closes the list, sets `aria-expanded` to
  `false` and leaves focus on the trigger

#### Scenario: Escape and outside clicks abandon the change
- **WHEN** the list is open with a focused entry that differs from the current value, and the user
  presses `Escape`, or clicks outside the control, or moves focus away
- **THEN** the list closes, the value is unchanged, no storage write happens and the trigger label
  still shows the previous value

#### Scenario: Type-ahead focuses by label
- **WHEN** the trigger has focus and the user types `d`, or opens the list and types `l`
- **THEN** the entry whose label starts with the typed character is focused and announced through
  `aria-activedescendant`, and pressing `Enter` commits it

#### Scenario: The state function needs no document
- **WHEN** the pure state function is called under `node --test` with a closed state and the key
  `ArrowDown`, then with the resulting state and `Enter`
- **THEN** the first call returns an open state whose focused index is the current value's index,
  and the second returns a closed state whose value is that entry, with no reference to any
  document, window or element

### Requirement: Edit lock during stage execute
<!-- via: 2026-09-09-dashboard-theme-lock-diff -->

While `.my-flow/state/current-change.json` records the stage `execute`, the whole dashboard SHALL
be read-only, because an agent is writing files continuously and a browser save in that window is
the concurrent write the modification-time guard was never meant to resolve. Every `POST /api/file`
SHALL be refused with status 423 and an error naming the change and the stage, before any check
that discloses the target's existence, modification time or content, and after the checks that
judge the request itself, so that a malformed or non-writable request keeps its own error. A read
through `GET /api/file` SHALL report the file as not writable and SHALL carry a human-readable
reason for a file that would otherwise be writable. The lock SHALL be evaluated from the state file
on every request, so that it lifts as soon as the stage changes, with no server restart and no page
reload. No other stage SHALL restrict editing.

#### Scenario: A save during execute is refused and changes nothing
- **WHEN** a save is posted for a file under an active change while the recorded stage is `execute`
- **THEN** the response is 423 with an error naming the lock, the change and the stage, and the
  file on disk is byte-identical to what it was before the request

#### Scenario: A read during execute reports the reason
- **WHEN** a file under an active change is read through the file endpoint while the recorded stage
  is `execute`
- **THEN** the response reports the file as not writable and carries a reason naming the change,
  while a file that is not writable for another reason carries no lock reason

#### Scenario: The lock lifts when the stage changes
- **WHEN** the recorded stage changes from `execute` to another stage while the server keeps
  running
- **THEN** the next read reports the file as writable with no reason, and the next save succeeds,
  without restarting the server or reloading the page

#### Scenario: A non-writable target keeps its own refusal
- **WHEN** a save is posted during stage `execute` for a file under `changes/archive/`, under
  `.my-flow/`, or for a target that is not markdown
- **THEN** the request is refused as not writable rather than as locked, so a client error is not
  hidden by the lock

#### Scenario: The lock precedes the modification-time check
- **WHEN** a save carrying a stale modification time is posted during stage `execute`
- **THEN** the response is the lock refusal and carries no on-disk content, because the request is
  refused before the file is read

### Requirement: Git detection
<!-- via: 2026-09-09-dashboard-theme-lock-diff -->

The system SHALL determine once, when the server starts, whether the project root lies inside a git
work tree, and SHALL report the result in `GET /api/health` and in the `hello` event of the update
stream. The result SHALL NOT change for the life of the server process, so that the presence of the
diff view is stable. When git is absent, or the root is not inside a work tree, the diff endpoints
SHALL answer 404 with a `no-git` error, the diff entry SHALL not appear in the navigation, and the
diff route SHALL render a one-line explanation. A git invocation that fails after a successful
detection SHALL be reported for that request alone, leaving the server and its other routes
running.

#### Scenario: A git project reports git support
- **WHEN** the dashboard is started against a project root inside a git work tree
- **THEN** the health endpoint and the `hello` event both report git as available, and the diff
  entry appears in the navigation

#### Scenario: A project without git loses the feature, not the server
- **WHEN** the dashboard is started against a directory that is not inside a git work tree
- **THEN** the health endpoint reports git as unavailable, both diff endpoints answer 404 with a
  `no-git` error, the diff entry is absent from the navigation, and every other page works exactly
  as it does in a git project

#### Scenario: A failing git call does not take the server down
- **WHEN** a git invocation for a diff request exits non-zero or times out
- **THEN** that request is answered with an error naming git, and the server continues to serve
  every other route

### Requirement: Diff view of the working tree
<!-- via: 2026-09-10-dashboard-ui-polish -->

The system SHALL provide a read-only view of the project's working tree against `HEAD`, covering
staged, unstaged and untracked files, and SHALL NOT stage, commit, revert or otherwise write
anything through git. `GET /api/diff` SHALL return the changed files with a root-relative,
forward-slash path, a status letter, the original path for a rename, per-file added and deleted
line counts, flags for binary and untracked files, and the file's own modification time in epoch
milliseconds as `mtimeMs`. That time SHALL be read without following symbolic links, so that an
entry which is a link reports the link's own time and never the target's, and SHALL be `null`
whenever the entry cannot be stated, as for a file that was deleted from the working tree.
`GET /api/diff/file` SHALL return the unified patch for one file, synthesising an all-added patch
for an untracked file rather than touching the index. A file whose patch exceeds a fixed size cap,
and a binary file, SHALL still be listed but SHALL be returned without a patch and marked as such.
In a repository with no commit yet the comparison SHALL be made against the empty tree rather than
failing. The file endpoint SHALL accept only a path that the current file list contains, so that
it cannot be used to read arbitrary files. The file list SHALL exclude everything under
`.my-flow/` by the server's own rule rather than by relying on the project ignoring that
directory, because it is disposable scratch that an adopting project need not ignore and that the
read allow-list exposes only as rendered markdown. Before reading an untracked file the system
SHALL confirm the path is a regular file without following symbolic links, so that a link inside
the project cannot be used to read a file outside it. The page SHALL show the changed files as a
collapsible tree or a flat list, switchable and remembered across visits, and SHALL render the
selected patch as added, removed and context lines with line numbers on both sides, escaping all
file content.

The page SHALL additionally mark the entry with the newest `mtimeMs` as the most recently
modified file, in the tree and in the flat list alike, with a title naming that modification time,
and the marker SHALL be legible in both the light and the dark palette. An entry whose `mtimeMs`
is `null` SHALL never be the marked one, and when no entry carries a time no entry SHALL be
marked. The marker SHALL be recomputed from whatever the page last fetched; the system SHALL NOT
add a watcher or a polling loop for it.

While the diff view is shown, the page SHALL bind keyboard shortcuts that move the selection to
the next file in the displayed order, to the previous file, and to the most recently modified
file, and SHALL list those shortcuts on the page itself beside the tree and flat-list toggle. The
shortcuts SHALL NOT fire while focus is in an input, a select, a textarea or a content-editable
element, and SHALL NOT claim any combination that uses a control, alt or meta modifier. They
SHALL be removed when the view is left, so that no diff shortcut is live on another page. Moving
the selection SHALL reveal the target row, expanding any collapsed directory that contains it.

#### Scenario: Modified, untracked and deleted files are all listed
- **WHEN** the diff list is requested for a repository holding a tracked file that was modified, a
  file that was deleted, and a new file that was never added
- **THEN** all three appear with the status letters for modified, deleted and untracked, with
  root-relative forward-slash paths, and the modified file carries its added and deleted line counts

#### Scenario: Each listed entry carries its own modification time
- **WHEN** the diff list is requested for a repository holding a modified tracked file, an
  untracked file, a file deleted from the working tree, and an untracked symbolic link pointing
  outside the project
- **THEN** the modified and the untracked entry each carry an `mtimeMs` equal to that file's own
  modification time on disk, the deleted entry carries `mtimeMs` of `null`, and the link's entry
  carries the link's own modification time rather than the time of the file it points at

#### Scenario: The most recently modified file is marked and reachable by a keystroke
- **WHEN** the diff page is showing a list in which one file has the newest modification time, and
  the user presses the shortcut for the latest-modified file, then the shortcuts for the next and
  the previous file
- **THEN** exactly one entry is marked as the most recently modified one and carries a title
  naming its modification time, the first keystroke selects that file and renders its patch, the
  next two move the selection one row forward and one row back in the order the page displays, and
  pressing the same keys while focus is in the theme control, or in any other input, select or
  textarea the page offers, changes no selection and leaves the keystroke to that control

#### Scenario: An untracked file yields an all-added patch without touching the index
- **WHEN** the patch is requested for an untracked file
- **THEN** the response is a unified patch whose every content line is an addition, and the git
  index is byte-identical to what it was before the request

#### Scenario: A deleted file still yields its patch
- **WHEN** the patch is requested for a file that was deleted from the working tree
- **THEN** the response carries the unified patch showing every line as removed

#### Scenario: Binary and oversized files are listed but not rendered
- **WHEN** the diff contains a binary file, or a file whose patch exceeds the size cap
- **THEN** the file appears in the list marked as binary or as too large, the patch response
  carries no patch text, and the page says why rather than rendering nothing

#### Scenario: An unlisted path cannot be read through the diff endpoint
- **WHEN** the patch is requested for a path that the current diff list does not contain, even one
  that exists in the repository
- **THEN** the request is refused with a bad-path error and no file content is returned

#### Scenario: The scratch directory never appears in a diff
- **WHEN** the diff list is requested for a project that does not ignore `.my-flow/`, so that its
  state file and its ask, verify and interview transcripts are tracked or untracked but visible to
  git
- **THEN** no path under `.my-flow/` appears in the list, and requesting a patch for one is refused
  as an unlisted path

#### Scenario: A symbolic link is listed but never followed
- **WHEN** the patch is requested for an untracked entry that is a symbolic link, or any other
  entry that is not a regular file
- **THEN** the response carries no patch and states that the entry was skipped, and the file the
  link points at is not read

#### Scenario: The page offers a tree and a flat list
- **WHEN** the user switches the file pane between the tree and the flat list
- **THEN** the same set of changed files is shown in the chosen form, the choice is remembered for
  the next visit, and selecting a file renders its patch with added and removed lines
  distinguished and numbered on both sides

### Requirement: Styleguide route
<!-- via: 2026-09-10-dashboard-design-parity -->

The dashboard SHALL serve a `#/styleguide` route, reachable from a link in the sidebar, that
renders every component the stylesheet defines and every state each of them has, side by side,
from static markup with no request to the API. The page SHALL show, at least: colour tokens, text
and links, every button variant, the navigation tile, tags, cards, panels, notices, the progress
bar, tables, code blocks, the task box in its open and done forms, the file tree with its toggles,
breadcrumbs, the patch view, the theme listbox both live and in a static open state, the form
controls (checkbox, radio, switch, text input, textarea, select trigger) and the markdown elements
the stylesheet covers (blockquote with footer and cite, definition list, figure and caption,
`kbd`, `mark`, `abbr`, `details` and `summary`, `sup` and `sub`, code line numbers, fieldset with
legend and label). For each control the page SHALL show the rest, hover, pressed, focus-visible
and disabled states, using marker classes that the stylesheet treats exactly like the
corresponding pseudo-class, so that a screenshot captures every state without a pointer. The page
SHALL render in both palettes through the existing theme control, and it SHALL NOT be the target
of any live-update refetch.

#### Scenario: Every component and state is visible in one place
- **WHEN** `#/styleguide` is opened
- **THEN** the page lists every component group named above, each control appears once per
  state with a caption naming the state, and switching the theme control to `dark` and back to
  `light` restyles the whole page without a reload

#### Scenario: The page is static
- **WHEN** `#/styleguide` is opened and a file under `changes/` is modified on disk
- **THEN** the page is rendered without any request to `/api/status`, `/api/validate` or
  `/api/file`, and the change event does not re-render it

#### Scenario: Every emitted class has a rule and every rule has a caller
- **WHEN** the class names emitted by `web/index.html`, `web/app.mjs`, `web/md.mjs` and
  `web/ui.mjs` are extracted, including the ones inside template-literal interpolations, and
  compared with the class selectors in `web/app.css`
- **THEN** every emitted class name has at least one rule, and every class selector in the
  stylesheet is emitted by at least one of those files, the styleguide page counting as an emitter

### Requirement: Design grammar and scrollbars
<!-- via: 2026-09-10-dashboard-design-parity -->

Every control the dashboard renders SHALL follow one control grammar: a 2 px border and a 3 px
hard offset shadow for controls, a 3 px border and a 6 px hard offset shadow for panels and menus,
square corners everywhere, a lime surface on hover, the pressed and open surface expressed through
one token pair that is ink on paper in the light palette and lime in the dark palette, a
focus-visible outline offset from the border that replaces the user-agent focus ring, reduced
opacity with no hover response when disabled, and transitions of 120 ms on transform, shadow and
colour. The stylesheet SHALL carry an explicit reset so that no user-agent default survives for the
elements it styles: form controls lose their native appearance and inherit the page font, no
border radius remains, the `summary` marker is removed, and no default focus ring shows where the
outline replaces it. Every rule that differs in the dark palette SHALL be declared twice, once
under the `prefers-color-scheme: dark` media query guarded by the absence of a forced light
theme and once under the forced dark theme attribute, with identical declarations. Every scrolling
region, that is the page, the sidebar, the editor textarea, the diff file pane, the patch view,
code blocks, tables and the listbox viewport, SHALL show the themed bar on whichever axis it
scrolls, SHALL paint the corner where both axes meet, and SHALL carry the standard scrollbar
colour and width properties as a fallback for engines without the WebKit pseudo-elements, with
the fallback never overriding the pseudo-element rules where both are supported.

#### Scenario: Dark rules are declared twice
- **WHEN** `web/app.css` is parsed and every rule under the dark media query is compared with
  every rule under the forced dark attribute
- **THEN** the two sets are identical selector by selector and declaration by declaration, apart
  from the `color-scheme` declaration that only the attribute block carries

#### Scenario: A wide table and a wide patch scroll with themed bars
- **WHEN** a rendered markdown table, a code block and a patch are each wider than their
  container, and the editor textarea is taller and wider than its box
- **THEN** each shows a horizontal bar in the page's scrollbar colours, the textarea additionally
  shows a vertical bar and a painted corner, and switching the theme recolours all of them

#### Scenario: No browser default leaks through
- **WHEN** the styleguide page is inspected in the light and in the dark palette
- **THEN** no control shows a native appearance, a rounded corner, a default summary marker or
  the user-agent focus ring, and every focused control shows the offset outline instead


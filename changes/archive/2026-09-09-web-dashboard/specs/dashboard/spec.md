# dashboard Specification

## Purpose
The local web dashboard: how the server starts, stops and records itself, what its JSON API
guarantees about parity with the CLI, how it pushes file changes to the browser, what the
guarded save endpoint allows and refuses, that the pages never reach the network, and which
markdown constructs the renderer covers.

## ADDED Requirements

### Requirement: Dashboard server lifecycle

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

The system SHALL accept edits only through `POST /api/file`, and SHALL allow a write only when
the target is a `*.md` file that already exists, resolves inside the project root, and lies
either under `specs/` or under an active `changes/<name>/`. Files under `changes/archive/` and
under `.my-flow/` SHALL never be writable. A path that is absolute, that escapes the root once
resolved, or that is not a string SHALL be rejected without touching the filesystem. Reading is
governed by a wider allow-list that also covers `changes/archive/` and the `ask`, `verify` and
`interviews` directories under `.my-flow/`, and a read response SHALL state whether that file is
writable.

#### Scenario: An active change file is saved
- **WHEN** a save is posted for `changes/<name>/proposal.md` of an active change with the
  current modification time
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

### Requirement: Modification-time conflict on save

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

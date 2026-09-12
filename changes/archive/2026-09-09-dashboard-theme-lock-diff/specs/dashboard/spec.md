## ADDED Requirements

### Requirement: Theme selection independent of the operating system

The dashboard SHALL offer a three-state theme control with the values `system`, `light` and
`dark`, defaulting to `system`. The choice SHALL be stored in the browser's local storage and
SHALL be applied before the first paint, so that no reload shows the wrong palette first. An
explicit `light` or `dark` choice SHALL override the operating system's `prefers-color-scheme`
setting in both directions, and `system` SHALL restore following it. The stylesheet SHALL express
this with an attribute on the document root, and every rule that today keys off the dark colour
scheme, including the scrollbar and the active navigation entry, SHALL follow the same switch. A
browser that refuses access to local storage SHALL still render the page, following the operating
system's scheme.

#### Scenario: An explicit choice beats the operating system
- **WHEN** the operating system reports a dark colour scheme and the user selects `light` in the
  theme control
- **THEN** the page renders with the light palette, including the scrollbars and the active
  navigation entry, and selecting `dark` under an operating system reporting light renders the
  dark palette

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

### Requirement: Edit lock during stage execute

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

The system SHALL provide a read-only view of the project's working tree against `HEAD`, covering
staged, unstaged and untracked files, and SHALL NOT stage, commit, revert or otherwise write
anything through git. `GET /api/diff` SHALL return the changed files with a root-relative,
forward-slash path, a status letter, the original path for a rename, per-file added and deleted
line counts, and flags for binary and untracked files. `GET /api/diff/file` SHALL return the
unified patch for one file, synthesising an all-added patch for an untracked file rather than
touching the index. A file whose patch exceeds a fixed size cap, and a binary file, SHALL still be
listed but SHALL be returned without a patch and marked as such. In a repository with no commit yet
the comparison SHALL be made against the empty tree rather than failing. The file endpoint SHALL
accept only a path that the current file list contains, so that it cannot be used to read arbitrary
files. The file list SHALL exclude everything under `.my-flow/` by the server's own rule rather
than by relying on the project ignoring that directory, because it is disposable scratch that an
adopting project need not ignore and that the read allow-list exposes only as rendered markdown.
Before reading an untracked file the system SHALL confirm the path is a regular file without
following symbolic links, so that a link inside the project cannot be used to read a file outside
it. The page SHALL show the changed files as a collapsible tree or a flat list, switchable and
remembered across visits, and SHALL render the selected patch as added, removed and context lines
with line numbers on both sides, escaping all file content.

#### Scenario: Modified, untracked and deleted files are all listed
- **WHEN** the diff list is requested for a repository holding a tracked file that was modified, a
  file that was deleted, and a new file that was never added
- **THEN** all three appear with the status letters for modified, deleted and untracked, with
  root-relative forward-slash paths, and the modified file carries its added and deleted line counts

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

## MODIFIED Requirements

### Requirement: Guarded save endpoint

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

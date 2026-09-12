# dashboard Specification (delta)

## MODIFIED Requirements

### Requirement: Diff view of the working tree

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

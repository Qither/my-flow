# Coding style (my-flow default)

- Follow the patterns already in the file you are editing; consistency beats preference.
- Small, focused changes: every changed line traces to the request. No drive-by refactors.
- Prefer immutability and pure functions where the language makes it cheap; avoid mutating
  inputs.
- Handle errors at the boundary where you can do something useful; never swallow them.
- Validate external input at the edge (user input, files, network), not deep inside.
- No debug output, commented-out code, or placeholder TODOs left in the diff.
- Keep files and functions readable: if a function no longer fits on a screen, that is a
  signal, not a rule.

## Project-specific style

<!-- Add naming conventions, file layout, framework-specific patterns. -->

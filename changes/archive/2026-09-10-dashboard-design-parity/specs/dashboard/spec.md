## MODIFIED Requirements

### Requirement: Theme selection independent of the operating system

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

## ADDED Requirements

### Requirement: Styleguide route

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

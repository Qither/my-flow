/**
 * Pure helpers for the stylesheet guards (design D3 and D10 of dashboard-design-parity).
 * No node:test import here on purpose: a one-off `node -e` script can import a helper and run
 * it over a scratchpad copy without also executing the suite.
 */

const collapse = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * Class names a source file emits. Scans every `class="..."` attribute, tracking template
 * literal nesting so a quote inside `${...}` does not end the attribute. Depth-0 text splits
 * on whitespace into names. Inside an expression a `'...'` or `"..."` literal counts only when
 * the non-space character before its opening quote is `?` or `:` (a conditional branch);
 * literals after `===`, `(`, `,` and anything else are comparison operands or arguments and
 * are ignored, as are bare identifiers. A backtick literal inside an expression is skipped
 * (the global scan finds any `class="` it contains on its own). Also collects
 * `classList.add|toggle('name'` calls. `supplement` adds names known to come from identifiers
 * (for example `${l.kind}`); `ignorePrefixes` drops names starting with a prefix.
 */
export function emittedClasses(text, { supplement = [], ignorePrefixes = ['language-'] } = {}) {
  const out = new Set();
  const add = (chunk) => {
    for (const name of chunk.split(/\s+/)) {
      if (name && !ignorePrefixes.some((p) => name.startsWith(p))) out.add(name);
    }
  };
  const marker = 'class="';
  let from = 0;
  for (;;) {
    const start = text.indexOf(marker, from);
    if (start < 0) break;
    let i = start + marker.length;
    let depth = 0;
    let seg = '';
    let expr = '';
    while (i < text.length) {
      const ch = text[i];
      if (depth === 0) {
        if (ch === '"') break;
        if (ch === '$' && text[i + 1] === '{') { add(seg); seg = ''; expr = ''; depth = 1; i += 2; continue; }
        seg += ch;
        i += 1;
        continue;
      }
      if (ch === '{') { depth += 1; expr += ch; i += 1; continue; }
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) { i += 1; continue; }
        expr += ch; i += 1; continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        const end = text.indexOf(ch, i + 1);
        if (end < 0) { i = text.length; break; }
        const before = expr.trimEnd().slice(-1);
        if (ch !== '`' && (before === '?' || before === ':')) add(text.slice(i + 1, end));
        expr += ch + text.slice(i + 1, end + 1);
        i = end + 1;
        continue;
      }
      expr += ch;
      i += 1;
    }
    add(seg);
    from = i + 1;
  }
  for (const m of text.matchAll(/classList\.(?:add|toggle)\(\s*'([^']+)'/g)) add(m[1]);
  for (const name of supplement) out.add(name);
  return out;
}

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const stripStrings = (css) => css.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');

/** Every class name a stylesheet selects, after removing comments and quoted strings. */
export function cssClasses(css) {
  const out = new Set();
  for (const m of stripStrings(stripComments(css)).matchAll(/\.([A-Za-z_][\w-]*)/g)) out.add(m[1]);
  return out;
}

/** CSS classes that no emitter uses, sorted. */
export function orphanClasses(css, emittedSet) {
  return [...cssClasses(css)].filter((c) => !emittedSet.has(c)).sort();
}

const DARK_MEDIA = '@media (prefers-color-scheme: dark)';
const MEDIA_PREFIX = ':root:not([data-theme="light"])';
const ATTR_PREFIX = ':root[data-theme="dark"]';

/** Index of the `}` matching the `{` at `open`. */
function closeOf(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i += 1) {
    if (s[i] === '{') depth += 1;
    else if (s[i] === '}') { depth -= 1; if (depth === 0) return i; }
  }
  return s.length;
}

/** Split `selector { body }` pairs at one nesting level. */
function rules(block) {
  const out = [];
  let i = 0;
  for (;;) {
    const open = block.indexOf('{', i);
    if (open < 0) break;
    const close = closeOf(block, open);
    out.push({ prelude: collapse(block.slice(i, open)), body: block.slice(open + 1, close) });
    i = close + 1;
  }
  return out;
}

const stripPrefix = (selector, prefix) =>
  selector.split(',').map((part) => {
    const p = part.trim();
    return p.startsWith(prefix) ? p.slice(prefix.length).trim() : p;
  }).join(', ');

const normDecls = (body) =>
  body.split(';').map((d) => collapse(d)).filter((d) => d && !d.startsWith('color-scheme')).sort().join('; ');

/**
 * Design D3: every rule inside `@media (prefers-color-scheme: dark)` (prefix
 * `:root:not([data-theme="light"])` stripped) must have a twin among the top-level rules
 * prefixed `:root[data-theme="dark"]` with identical declarations (`color-scheme` ignored),
 * as multisets. Returns null when they match, else the first differing selector as
 * `{ selector, media, attr }` with the declaration lists found on each side.
 */
export function darkTwinMismatch(css) {
  const text = stripComments(css);
  const media = new Map();
  const attr = new Map();
  const push = (map, selector, decls) => { if (!map.has(selector)) map.set(selector, []); map.get(selector).push(decls); };
  for (const top of rules(text)) {
    if (top.prelude.startsWith('@')) {
      if (top.prelude !== DARK_MEDIA) continue;
      for (const r of rules(top.body)) push(media, stripPrefix(r.prelude, MEDIA_PREFIX), normDecls(r.body));
    } else if (top.prelude.split(',').every((p) => p.trim().startsWith(ATTR_PREFIX))) {
      push(attr, stripPrefix(top.prelude, ATTR_PREFIX), normDecls(top.body));
    }
  }
  const selectors = [...new Set([...media.keys(), ...attr.keys()])];
  for (const selector of selectors) {
    const a = (media.get(selector) ?? []).slice().sort();
    const b = (attr.get(selector) ?? []).slice().sort();
    if (a.length !== b.length || a.some((d, k) => d !== b[k])) return { selector, media: a, attr: b };
  }
  return null;
}

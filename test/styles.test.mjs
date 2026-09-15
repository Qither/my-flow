/**
 * Stylesheet guards for the dashboard (dashboard-design-parity): the class extractor and the
 * dark-twin comparison are unit-tested against the literal patterns found in web/app.mjs and
 * web/md.mjs before they are applied to the real files.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { cssClasses, darkTwinMismatch, emittedClasses, orphanClasses } from './styles.lib.mjs';

const names = (text, opts) => [...emittedClasses(text, opts)].sort();

test('emittedClasses: conditional branches count, comparison operands do not (app.mjs:207,284,322,428,432)', () => {
  assert.deepEqual(names('`<span class="tag${v === \'done\' ? \'\' : \' warn\'}">`'), ['tag', 'warn']);
  const archive = names('`<span class="tag${e.kind === \'abandoned\' ? \' warn\' : \' lime\'}">`');
  assert.deepEqual(archive, ['lime', 'tag', 'warn']);
  assert.ok(!archive.includes('abandoned'), 'a comparison operand is not a class');
  assert.deepEqual(names('`<span class="tag${body.writable ? \' lime\' : \'\'}">`'), ['lime', 'tag']);
  assert.deepEqual(names('`<li class="file${f.path === path ? \' selected\' : \'\'}">`'), ['file', 'selected']);
  assert.deepEqual(names('`<li class="dir${closed ? \' closed\' : \'\'}">`'), ['closed', 'dir']);
});

test('emittedClasses: md.mjs patterns (task line, language- prefix ignored)', () => {
  assert.deepEqual(names('`<li class="task ${done ? \'done\' : \'open\'}"><span class="box" aria-hidden="true">`'), ['box', 'done', 'open', 'task']);
  assert.deepEqual(names('const cls = fence[2] ? ` class="language-${escapeHtml(fence[2])}"` : \'\';'), []);
});

test('emittedClasses: identifiers need a supplement, nested templates and quotes inside expressions do not end the attribute', () => {
  const row = '`<div class="row ${l.kind}"><span class="no">${l.oldNo ?? \'\'}</span></div>`';
  assert.deepEqual(names(row), ['no', 'row']);
  assert.deepEqual(names(row, { supplement: ['add', 'del', 'ctx', 'meta'] }), ['add', 'ctx', 'del', 'meta', 'no', 'row']);
  const nested = '`<li class="file${f.path === path ? \' selected\' : \'\'}"><a>${f.path === latest ? `<span class="tag latest" title="most recently modified, ${esc(when(f.mtimeMs))}">●</span>` : \'\'}</a></li>`';
  assert.deepEqual(names(nested), ['file', 'latest', 'selected', 'tag']);
  assert.deepEqual(names('a.classList.toggle(\'active\', x); view.classList.toggle(\'wide\', y); el?.classList.add(\'highlight\');'), ['active', 'highlight', 'wide']);
});

test('cssClasses: comments and quoted strings are stripped, numbers are not classes', () => {
  const css = '/* paper / ink / lime (design D9, after ../my-flow-sample/src/styles/globals.css). */\n.a { font-size: 0.9em; content: ".fake"; }\n.b-c:hover, .d_e { }\n';
  assert.deepEqual([...cssClasses(css)].sort(), ['a', 'b-c', 'd_e']);
  assert.ok(!cssClasses(css).has('css'), 'the comment mention of globals.css is not a class');
});

test('orphanClasses: rules with no emitter, sorted', () => {
  assert.deepEqual(orphanClasses('.b{} .a{} .c{}', new Set(['a'])), ['b', 'c']);
});

const twinFixture = (mediaThumb, attrThumb) => `
:root { --x: 1; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper: black;
    --ink: white;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --ink: white;
  --paper: black;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .nav a.active { background: var(--lime); color: var(--lime-ink); } }
:root[data-theme="dark"] .nav a.active { background: var(--lime); color: var(--lime-ink); }
@media (max-width: 1000px) { .editor { grid-template-columns: 1fr; } }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) body::-webkit-scrollbar-thumb { border-left: ${mediaThumb}; }
}
:root[data-theme="dark"] body::-webkit-scrollbar-thumb { border-left: ${attrThumb}; }
@supports not selector(::-webkit-scrollbar) { body { scrollbar-width: auto; } }
`;

test('darkTwinMismatch: equal twins pass (prefix stripped, color-scheme ignored, other at-rules skipped)', () => {
  assert.equal(darkTwinMismatch(twinFixture('4px solid #000', '4px solid #000')), null);
});

test('darkTwinMismatch: one changed declaration names the selector', () => {
  const r = darkTwinMismatch(twinFixture('4px solid #000', '2px solid #000'));
  assert.equal(r.selector, 'body::-webkit-scrollbar-thumb');
  assert.deepEqual(r.media, ['border-left: 4px solid #000']);
  assert.deepEqual(r.attr, ['border-left: 2px solid #000']);
  const missing = darkTwinMismatch(twinFixture('4px', '4px') + ':root[data-theme="dark"] .extra { color: red; }');
  assert.equal(missing.selector, '.extra');
  assert.deepEqual(missing.media, []);
});

// ---------------------------------------------------------------- the real files

const WEB = new URL('../web/', import.meta.url);
const read = (name) => readFileSync(new URL(name, WEB), 'utf8');
const EMITTERS = [['index.html', {}], ['app.mjs', { supplement: ['add', 'del', 'ctx', 'meta'] }], ['md.mjs', {}], ['ui.mjs', {}]];
// Classes app.css may select without any emitter. Empty on purpose: add the missing example to
// the styleguide (pageStyleguide in web/app.mjs) rather than a name here.
const ORPHAN_ALLOWLIST = [];
const emitted = () => {
  const out = new Set();
  for (const [name, opts] of EMITTERS) for (const c of emittedClasses(read(name), opts)) out.add(c);
  return out;
};

test('app.css: every class the pages emit has a rule', () => {
  const css = cssClasses(read('app.css'));
  const missing = [...emitted()].filter((c) => !css.has(c)).sort();
  assert.deepEqual(missing, [], `emitted classes with no rule in app.css: ${missing.join(', ')}`);
});

test('app.css: every class rule has an emitter (reverse coverage, allowlist empty)', () => {
  const orphans = orphanClasses(read('app.css'), emitted()).filter((c) => !ORPHAN_ALLOWLIST.includes(c));
  assert.deepEqual(orphans, [], `app.css selects classes nothing emits: ${orphans.join(', ')}`);
  assert.deepEqual(ORPHAN_ALLOWLIST, []);
});

test('app.css: dark rules are declared twice and the twins are identical', () => {
  assert.equal(darkTwinMismatch(read('app.css')), null);
});

test('web/: no served file references the network, and ui.mjs is among the scanned files', () => {
  const dir = fileURLToPath(WEB);
  const names = readdirSync(dir);
  assert.ok(names.includes('ui.mjs'), 'web/ui.mjs is served and therefore scanned');
  for (const name of names) {
    assert.ok(!/https?:\/\//.test(readFileSync(join(dir, name), 'utf8')), `${name} references http(s)://`);
  }
});

test('package.json: no runtime dependencies', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
});

test('app.css: the linked task rules use palette tokens only, so both palettes follow the twins', () => {
  const css = read('app.css');
  const start = css.indexOf('/* linked task rows');
  assert.ok(start > 0, 'the linked task block is present');
  const block = css.slice(start, css.indexOf('/* rendered markdown', start));
  const literals = block.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\b(?:black|white|red|green|blue|gray|grey)\b/g) ?? [];
  assert.deepEqual(literals, [], `a literal colour would need its own dark twin: ${literals.join(', ')}`);
  for (const rule of ['.task-row', '.task-result', '.task-why', '.task-detail summary', '.ref-label']) {
    assert.ok(block.includes(rule), `${rule} has a rule`);
  }
  assert.equal(darkTwinMismatch(css), null, 'and every explicit dark rule is still declared twice and identical');
});

test('app.css: long unbreakable content wraps instead of widening the page', () => {
  const css = read('app.css');
  for (const rule of ['.task-result', '.task-why', '.refs li']) {
    const at = css.indexOf(`${rule} {`);
    assert.ok(at > 0, `${rule} has a rule`);
    assert.match(css.slice(at, css.indexOf('}', at)), /overflow-wrap: anywhere/, `${rule} wraps unbreakable tokens`);
  }
});

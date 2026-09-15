/**
 * web/md.mjs: the markdown subset the templates use, its escaping, and its fallbacks.
 * Expected strings are fixed so a change in output is a deliberate change here too.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { escapeHtml, findVia, renderMarkdown, safeLinkTarget } from '../web/md.mjs';
import { TEMPLATES } from './helpers.mjs';

const BOX_OPEN = '<span class="box" aria-hidden="true">&#9744;</span>';
const BOX_DONE = '<span class="box" aria-hidden="true">&#9745;</span>';

test('md: headings, paragraphs and horizontal rules', () => {
  assert.equal(renderMarkdown('# One\n\n## Two ##\n\n###### Six'), '<h1>One</h1>\n<h2>Two</h2>\n<h6>Six</h6>');
  assert.equal(renderMarkdown('first line\nsecond line\n\nnext para'), '<p>first line\nsecond line</p>\n<p>next para</p>');
  assert.equal(renderMarkdown('above\n\n---\n\nbelow'), '<p>above</p>\n<hr>\n<p>below</p>');
  assert.equal(renderMarkdown('* * *'), '<hr>');
});

test('md: unordered, ordered and nested lists', () => {
  assert.equal(renderMarkdown('- a\n- b\n  - b1\n  - b2\n- c'), '<ul><li>a</li><li>b<ul><li>b1</li><li>b2</li></ul></li><li>c</li></ul>');
  assert.equal(renderMarkdown('1. one\n2. two'), '<ol><li>one</li><li>two</li></ol>');
  assert.equal(renderMarkdown('- a\n1. b'), '<ul><li>a</li></ul>\n<ol><li>b</li></ol>');
  assert.equal(renderMarkdown('- a\n  continued'), '<ul><li>a continued</li></ul>');
});

test('md: task items carry a glyph and an open / done class', () => {
  assert.equal(
    renderMarkdown('- [ ] 1.1 open and verify a\n- [x] 1.2 done and verify b\n- [X] 1.3 also done'),
    `<ul><li class="task open">${BOX_OPEN} 1.1 open and verify a</li><li class="task done">${BOX_DONE} 1.2 done and verify b</li><li class="task done">${BOX_DONE} 1.3 also done</li></ul>`
  );
});

test('md: fenced code is escaped and never parsed', () => {
  assert.equal(renderMarkdown('```js\nconst x = "<b>" && **not bold**;\n```'), '<pre><code class="language-js">const x = &quot;&lt;b&gt;&quot; &amp;&amp; **not bold**;\n</code></pre>');
  assert.equal(renderMarkdown('~~~\n# not a heading\n<!-- kept -->\n~~~'), '<pre><code># not a heading\n&lt;!-- kept --&gt;\n</code></pre>');
  assert.equal(renderMarkdown('```\nunterminated'), '<pre><code>unterminated\n</code></pre>');
});

test('md: pipe tables with alignment', () => {
  assert.equal(
    renderMarkdown('| Left | Center | Right |\n|:-----|:------:|------:|\n| a | b | c |\n| `d` | **e** | f \\| g |'),
    '<table><thead><tr><th style="text-align:left">Left</th><th style="text-align:center">Center</th><th style="text-align:right">Right</th></tr></thead>' +
      '<tbody><tr><td style="text-align:left">a</td><td style="text-align:center">b</td><td style="text-align:right">c</td></tr>' +
      '<tr><td style="text-align:left"><code>d</code></td><td style="text-align:center"><strong>e</strong></td><td style="text-align:right">f | g</td></tr></tbody></table>'
  );
  assert.equal(renderMarkdown('Method | Route\n---|---\nGET | /api/status'), '<table><thead><tr><th>Method</th><th>Route</th></tr></thead><tbody><tr><td>GET</td><td>/api/status</td></tr></tbody></table>');
});

test('md: inline bold, code and safe links', () => {
  assert.equal(renderMarkdown('**bold** and `code **x**` and 1.2 plain'), '<p><strong>bold</strong> and <code>code **x**</code> and 1.2 plain</p>');
  assert.equal(renderMarkdown('[frag](#/changes) [rel](./x.md) [up](../y.md) [bare](docs/x.md#s) [abs](/z)'), '<p><a href="#/changes">frag</a> <a href="./x.md">rel</a> <a href="../y.md">up</a> <a href="docs/x.md#s">bare</a> <a href="/z">abs</a></p>');
  assert.equal(renderMarkdown('[h](http://example.test/a) [s](https://example.test/b?q=1&r=2)'), '<p><a href="http://example.test/a">h</a> <a href="https://example.test/b?q=1&amp;r=2">s</a></p>');
});

test('md: comments are hidden and a via marker becomes a link to the archived change', () => {
  const out = renderMarkdown('### Requirement: Foo\n<!-- via: 2026-01-01-old -->\n<!-- an ordinary comment -->\n\nBody <!-- inline --> text.\n');
  assert.equal(out, '<h3>Requirement: Foo</h3>\n<p><a class="via" href="#/archive/2026-01-01-old" title="archived change that produced this requirement">via 2026-01-01-old</a></p>\n<p>Body  text.</p>');
  assert.equal(out.includes('<!--'), false, 'no comment survives');
  assert.equal(renderMarkdown('<!-- multi\nline -->\nafter'), '<p>after</p>');
  assert.equal(renderMarkdown('<!-- via: ../evil -->'), '<p>via ../evil</p>', 'a via value that is not a change name is plain text');
  assert.deepEqual(findVia('a <!-- via: 2026-01-01-old --> b <!--via:2026-02-02-new-->'), ['2026-01-01-old', '2026-02-02-new']);
});

/** The v2 task template carries its stable fields as an ordinary nested list. */
const fields = (...items) => '<ul>' + items.map((i) => '<li>' + i + '</li>').join('') + '</ul>';
test('md: golden render of the change templates', () => {
  const design = readFileSync(join(TEMPLATES, 'design.md'), 'utf8');
  assert.equal(
    renderMarkdown(design),
    [
      '<h2>Context</h2>',
      '<h2>Goals / Non-Goals</h2>',
      '<p><strong>Goals:</strong></p>',
      '<p><strong>Non-Goals:</strong></p>',
      '<h2>Decisions</h2>',
      '<h3>D-01 —</h3>',
      '<h3>D-02 —</h3>',
      '<h2>Risks / Trade-offs</h2>',
      '<h2>Do-Not-Touch</h2>',
      '<h2>Rebuild / Re-run After Change</h2>',
      '<h2>File Ownership</h2>',
    ].join('\n')
  );
  const tasks = readFileSync(join(TEMPLATES, 'tasks.md'), 'utf8');
  assert.equal(
    renderMarkdown(tasks),
    [
      '<h2>1.</h2>',
      `<ul><li class="task open">${BOX_OPEN} 1.1  and verify ${fields('id: T-01', 'depends-on: none', 'accepts: AC-01', 'design: D-01')}</li>` +
        `<li class="task open">${BOX_OPEN} 1.2  and verify ${fields('id: T-02', 'depends-on: T-01', 'accepts: AC-01')}</li></ul>`,
      '<h2>2.</h2>',
      `<ul><li class="task open">${BOX_OPEN} 2.1  and verify ${fields('id: T-03', 'depends-on: T-02', 'accepts: AC-02')}</li></ul>`,
      '<h2>3. Final gate</h2>',
      `<ul><li class="task open">${BOX_OPEN} 3.1 Targeted verification of the whole change (build, tests, Rebuild / Re-run steps)${fields('id: T-04', 'depends-on: T-03')}</li>` +
        `<li class="task open">${BOX_OPEN} 3.2 Cleanup of own diff only, then re-verify${fields('id: T-05', 'depends-on: T-04')}</li>` +
        `<li class="task open">${BOX_OPEN} 3.3 Independent verification report says PASS (.my-flow/verify/)${fields('id: T-06', 'depends-on: T-05', 'kind: closeout')}</li></ul>`,
    ].join('\n')
  );
});

// ---------------------------------------------------------------- 5.2 safety and fallback
test('md: file content cannot inject markup', () => {
  assert.equal(renderMarkdown('<script>alert(1)</script> & "q" \'s'), '<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot; &#39;s</p>');
  assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(renderMarkdown('# <img src=x onerror=alert(1)>'), '<h1>&lt;img src=x onerror=alert(1)&gt;</h1>');
  assert.equal(renderMarkdown('| <b>x</b> |\n|---|\n| <i>y</i> |'), '<table><thead><tr><th>&lt;b&gt;x&lt;/b&gt;</th></tr></thead><tbody><tr><td>&lt;i&gt;y&lt;/i&gt;</td></tr></tbody></table>');
});

test('md: dangerous link targets never reach an href', () => {
  for (const target of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:msgbox', 'mailto:x@y', 'file:///etc/passwd', 'a:b/c']) {
    const out = renderMarkdown(`[x](${target})`);
    assert.equal(out.includes('href'), false, target);
    assert.equal(out, `<p>[x](${escapeHtml(target)})</p>`);
    assert.equal(safeLinkTarget(target), false, target);
  }
  for (const target of ['#top', './a.md', '../a.md', 'a/b:c', 'http://h/p', 'https://h/p', 'docs/readme.md']) assert.equal(safeLinkTarget(target), true, target);
  assert.equal(renderMarkdown('[x](javascript:alert(1)) and [ok](./fine.md)'), '<p>[x](javascript:alert(1)) and <a href="./fine.md">ok</a></p>');
});

test('md: unsupported constructs degrade to escaped text', () => {
  assert.equal(renderMarkdown('> a quote'), '<p>&gt; a quote</p>');
  assert.equal(renderMarkdown('![alt](x.png)'), '<p>![alt](x.png)</p>');
  const out = renderMarkdown('before\n\n> quote\n\n![img](x.png)\n\nafter');
  assert.equal(out.includes('<blockquote'), false);
  assert.equal(out.includes('<img'), false);
  assert.equal(out, '<p>before</p>\n<p>&gt; quote</p>\n<p>![img](x.png)</p>\n<p>after</p>');
  assert.equal(renderMarkdown('_emphasis_ and [ref][1]\n\n[1]: http://x'), '<p>_emphasis_ and [ref][1]</p>\n<p>[1]: http://x</p>');
  assert.equal(renderMarkdown('Setext\n======'), '<p>Setext\n======</p>');
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown(null), '');
  assert.equal(renderMarkdown('crlf\r\nline\r\n'), '<p>crlf\nline</p>');
});

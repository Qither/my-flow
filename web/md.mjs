/**
 * Minimal markdown renderer for the subset the my-flow templates and specs use (design D8).
 * DOM-free: the browser imports it as a module and `node --test` imports the same file.
 *
 * Every text run is HTML-escaped before any markup is applied, so file content cannot inject
 * HTML. Supported: ATX headings, paragraphs, `-`/`*`/`1.` lists with one level of nesting,
 * task items, fenced code, GFM pipe tables, `**bold**`, `` `code` ``, safe links, horizontal
 * rules. HTML comments are hidden, except `<!-- via: <date>-<name> -->`, which becomes a link
 * to the archived change. Everything else renders as escaped plain text.
 */

// Control characters as placeholders: they survive escaping and cannot occur in markdown prose.
const CODE_MARK = String.fromCharCode(1);
const VIA_MARK = String.fromCharCode(2);
const VIA_OK = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** A link target is safe when it is a fragment, an explicit relative path, http(s), or a bare relative path with no colon before its first slash. */
export function safeLinkTarget(target) {
  if (!target || /[\s<>"'`]/.test(target)) return false;
  if (target.startsWith('#') || target.startsWith('./') || target.startsWith('../') || target.startsWith('/')) return true;
  if (/^https?:\/\//i.test(target)) return true;
  const head = target.split('/')[0];
  return !head.includes(':');
}

/** Inline markup on an already-escaped string: code spans, bold, links, via markers. */
export function renderInline(escaped) {
  const codes = [];
  let s = escaped.replace(/`([^`\n]+)`/g, (_, c) => {
    codes.push(`<code>${c}</code>`);
    return `${CODE_MARK}${codes.length - 1}${CODE_MARK}`;
  });
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^!])\[([^\]\n]+)\]\(([^()\s]+)\)/g, (m, pre, text, target) => {
    const raw = target.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    return safeLinkTarget(raw) ? `${pre}<a href="${target}">${text}</a>` : m;
  });
  s = s.replace(new RegExp(`${VIA_MARK}([^${VIA_MARK}]*)${VIA_MARK}`, 'g'), (_, via) =>
    VIA_OK.test(via) ? `<a class="via" href="#/archive/${via}" title="archived change that produced this requirement">via ${via}</a>` : `via ${via}`
  );
  return s.replace(new RegExp(`${CODE_MARK}([0-9]+)${CODE_MARK}`, 'g'), (_, i) => codes[Number(i)]);
}

const inline = (text) => renderInline(escapeHtml(text));

/** Removes HTML comments outside fenced code, keeping via markers as tokens. */
function stripComments(text) {
  const out = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let chunk = [];
  let fence = null;
  const flush = () => {
    if (!chunk.length) return;
    const joined = chunk
      .join('\n')
      .replace(/<!--\s*via:\s*(.+?)\s*-->/g, (_, via) => `${VIA_MARK}${via}${VIA_MARK}`)
      .replace(/<!--[\s\S]*?-->/g, '');
    out.push(...joined.split('\n'));
    chunk = [];
  };
  for (const line of lines) {
    const f = /^(\s*)(`{3,}|~{3,})/.exec(line);
    if (fence) {
      out.push(line);
      if (f && f[2][0] === fence[0] && f[2].length >= fence.length) fence = null;
    } else if (f) {
      flush();
      fence = f[2];
      out.push(line);
    } else chunk.push(line);
  }
  flush();
  return out;
}

const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const LIST = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+-]*)\s*$/;

function splitCells(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}

function listItem(content) {
  const task = /^\[([ xX])\]\s+(.*)$/.exec(content);
  if (task) {
    const done = task[1] !== ' ';
    return `<li class="task ${done ? 'done' : 'open'}"><span class="box" aria-hidden="true">${done ? '&#9745;' : '&#9744;'}</span> ${inline(task[2])}</li>`;
  }
  return `<li>${inline(content)}</li>`;
}

export function renderMarkdown(text) {
  const lines = stripComments(text ?? '');
  const html = [];
  let i = 0;
  const isBlank = (l) => l === undefined || !l.trim();
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !(FENCE.test(lines[i]) && FENCE.exec(lines[i])[1][0] === fence[1][0] && FENCE.exec(lines[i])[1].length >= fence[1].length)) body.push(lines[i++]);
      i++; // closing fence (or EOF)
      const cls = fence[2] ? ` class="language-${escapeHtml(fence[2])}"` : '';
      html.push(`<pre><code${cls}>${escapeHtml(body.join('\n'))}\n</code></pre>`);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      html.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
      i++;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('|')) {
      const head = splitCells(line);
      const aligns = splitCells(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null));
      const attr = (k) => (aligns[k] ? ` style="text-align:${aligns[k]}"` : '');
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && !isBlank(lines[i])) rows.push(splitCells(lines[i++]));
      html.push(
        `<table><thead><tr>${head.map((c, k) => `<th${attr(k)}>${inline(c)}</th>`).join('')}</tr></thead>` +
          (rows.length ? `<tbody>${rows.map((r) => `<tr>${head.map((_, k) => `<td${attr(k)}>${inline(r[k] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>` : '') +
          '</table>'
      );
      continue;
    }
    if (HR.test(line)) {
      html.push('<hr>');
      i++;
      continue;
    }
    const list = LIST.exec(line);
    if (list) {
      const ordered = /\d/.test(list[2]);
      const tag = ordered ? 'ol' : 'ul';
      const items = []; // { html, children: [] }
      while (i < lines.length) {
        const m = LIST.exec(lines[i]);
        if (!m) {
          // lazy continuation: an indented non-blank line extends the previous item
          if (!isBlank(lines[i]) && /^\s{2,}/.test(lines[i]) && items.length) {
            const target = items.at(-1).children.at(-1) ?? items.at(-1);
            target.html = target.html.replace(/<\/li>$/, ` ${inline(lines[i].trim())}</li>`);
            i++;
            continue;
          }
          break;
        }
        const nested = m[1].length >= 2 && items.length;
        if (!nested && /[0-9]/.test(m[2]) !== ordered) break;
        const item = { html: listItem(m[3]), children: [], ordered: /\d/.test(m[2]) };
        if (nested) items.at(-1).children.push(item);
        else items.push(item);
        i++;
      }
      const render = (it) => {
        if (!it.children.length) return it.html;
        const t = it.children[0].ordered ? 'ol' : 'ul';
        return it.html.replace(/<\/li>$/, `<${t}>${it.children.map(render).join('')}</${t}></li>`);
      };
      html.push(`<${tag}>${items.map(render).join('')}</${tag}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && !isBlank(lines[i]) && !HEADING.test(lines[i]) && !FENCE.test(lines[i]) && !LIST.test(lines[i]) && !HR.test(lines[i])) para.push(lines[i++].trim());
    html.push(`<p>${inline(para.join('\n'))}</p>`);
  }
  return html.join('\n');
}

/** Provenance markers found in a text, in order: ['2026-01-01-old', ...]. */
export function findVia(text) {
  return [...String(text ?? '').matchAll(/<!--\s*via:\s*(.+?)\s*-->/g)].map((m) => m[1]);
}

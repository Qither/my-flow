/**
 * my-flow dashboard client (design D9): hash router, four pages, one file editor, and an
 * EventSource client that refetches only what the current route needs.
 *
 * Exports the pure pieces (route parsing, refetch decision, echo check) so `node --test` can
 * exercise them without a DOM; `boot()` runs only when the shell is present.
 */
import { escapeHtml as esc, renderMarkdown } from './md.mjs';

// ---------------------------------------------------------------- pure helpers
/** '#/changes/demo' -> { page: 'changes', name: 'demo' }; '#/file/<enc>' -> { page: 'file', path } */
export function parseRoute(hash) {
  const parts = (hash || '#/changes').replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [page = 'changes', ...rest] = parts;
  if (page === 'file') return { page, path: rest.join('/') };
  if (page === 'diff') return { page, path: rest.length ? rest.join('/') : null };
  if (page === 'changes') return { page, name: rest[0] ?? null };
  if (page === 'specs') return { page, name: rest[0] ?? null };
  if (page === 'archive') return { page, name: rest[0] ?? null };
  if (page === 'scratch') return { page };
  return { page: 'changes', name: null };
}
export const fileRoute = (path) => `#/file/${encodeURIComponent(path)}`;

/** Does a `change` event carrying these root-relative paths affect this route? */
export function shouldRefetch(route, paths) {
  const any = (pred) => paths.some(pred);
  switch (route.page) {
    case 'changes':
      return any((p) => p.startsWith('changes/') || p.startsWith('specs/') || p === '.my-flow/state/current-change.json');
    case 'specs':
      return any((p) => p.startsWith('specs/') || p.startsWith('changes/'));
    case 'archive':
      return any((p) => p.startsWith('changes/archive'));
    case 'scratch':
      return any((p) => p.startsWith('.my-flow/'));
    case 'file':
      // the state file decides the execute lock, so every editor reacts to it
      return any((p) => p === route.path || p === '.my-flow/state/current-change.json');
    case 'diff':
      return true; // any write can change the working-tree diff
    default:
      return true;
  }
}

/** Unified diff text -> { header: [...], hunks: [{ header, lines: [{ kind, oldNo, newNo, text }] }] }; kind is add | del | ctx | meta. */
export function parseUnifiedDiff(text) {
  const header = [];
  const hunks = [];
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop(); // the patch's own trailing newline
  let hunk = null;
  let oldNo = 0;
  let newNo = 0;
  for (const line of lines) {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (m) {
      oldNo = Number(m[1]);
      newNo = Number(m[2]);
      hunk = { header: line, lines: [] };
      hunks.push(hunk);
    } else if (!hunk || line.startsWith('diff --git')) {
      hunk = null;
      header.push(line);
    } else if (line.startsWith('+')) hunk.lines.push({ kind: 'add', oldNo: null, newNo: newNo++, text: line.slice(1) });
    else if (line.startsWith('-')) hunk.lines.push({ kind: 'del', oldNo: oldNo++, newNo: null, text: line.slice(1) });
    else if (line.startsWith('\\')) hunk.lines.push({ kind: 'meta', oldNo: null, newNo: null, text: line.slice(2) });
    else hunk.lines.push({ kind: 'ctx', oldNo: oldNo++, newNo: newNo++, text: line.slice(1) });
  }
  return { header, hunks };
}

/** Diff entries -> nested { name, path, dirs, files }, directories before files, both sorted. */
export function buildTree(files) {
  const root = { name: '', path: '', dirs: [], files: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    let acc = '';
    for (const part of parts.slice(0, -1)) {
      acc = acc ? `${acc}/${part}` : part;
      let dir = node.dirs.find((d) => d.name === part);
      if (!dir) {
        dir = { name: part, path: acc, dirs: [], files: [] };
        node.dirs.push(dir);
      }
      node = dir;
    }
    node.files.push(f);
  }
  const byteOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // git's own ordering, not locale rules
  const sortNode = (n) => {
    n.dirs.sort((a, b) => byteOrder(a.name, b.name));
    n.files.sort((a, b) => byteOrder(a.path, b.path));
    n.dirs.forEach(sortNode);
  };
  sortNode(root);
  return root;
}

/** Diff tree -> the entries in the order the page renders them: each node's directories first, then its files. */
export function flattenTree(node) {
  return [...node.dirs.flatMap(flattenTree), ...node.files];
}

/** 'a/b/c.md' -> ['a', 'a/b']; the directories that must be open for that row to be visible. */
export function ancestorDirs(path) {
  const parts = String(path ?? '').split('/').slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}

/** Keyboard targets over the rendered order: { next, prev, latest }, wrapping at both ends. */
export function diffNav(files, current) {
  const paths = files.map((f) => f.path);
  let latest = null;
  for (const f of files) if (typeof f.mtimeMs === 'number' && (latest === null || f.mtimeMs > latest.mtimeMs)) latest = f;
  const out = { next: null, prev: null, latest: latest ? latest.path : null };
  if (!paths.length) return out;
  const i = paths.indexOf(current);
  if (i === -1) return { ...out, next: paths[0], prev: paths.at(-1) };
  return { ...out, next: paths[(i + 1) % paths.length], prev: paths[(i - 1 + paths.length) % paths.length] };
}

/** A change event for the editor's own file is an echo when the file's mtime equals the last successful save. */
export const isOwnEcho = (lastSavedMtime, diskMtime) => lastSavedMtime !== null && lastSavedMtime === diskMtime;

// Theme (design D9): 'system' | 'light' | 'dark'; only the forced two become a data-theme attribute.
export const THEME_KEY = 'my-flow.theme';
export const DIFF_VIEW_KEY = 'my-flow.diffView';
export const normalizeTheme = (v) => (v === 'light' || v === 'dark' ? v : 'system');
export const themeAttr = (choice) => (choice === 'system' ? null : choice);

const pct = (t) => (t && t.total ? Math.round((t.done / t.total) * 100) : 0);
const when = (ms) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) : '');

export function progressHtml(t) {
  if (!t) return '<span class="meta">no tasks.md</span>';
  return `<span class="progress"><span class="bar"><span class="fill" style="width:${pct(t)}%"></span></span><span class="mono">${t.done}/${t.total}</span></span>`;
}

// ---------------------------------------------------------------- app
export function boot(doc = globalThis.document, win = globalThis.window) {
  const view = doc.getElementById('view');
  const $ = (id) => doc.getElementById(id);
  const api = async (path, init) => {
    const r = await fetch(path, init);
    const body = await r.json().catch(() => ({ ok: false, error: 'bad-json', message: `HTTP ${r.status}` }));
    return { status: r.status, ok: r.ok, body };
  };
  const state = { root: null, route: parseRoute(win.location.hash), editor: null, es: null, git: false, diffClosed: new Set() };
  // Storage is a convenience, never a requirement: every call is guarded so a denied localStorage
  // still leaves the theme control and the diff view toggle working for the session.
  const storage = {
    get(key) {
      try {
        return win.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        win.localStorage.setItem(key, value);
      } catch {
        /* denied: the choice lives for this page only */
      }
    },
    remove(key) {
      try {
        win.localStorage.removeItem(key);
      } catch {
        /* denied */
      }
    },
  };
  const applyTheme = (choice) => {
    const attr = themeAttr(choice);
    const html = doc.documentElement;
    if (html) {
      if (attr) html.setAttribute('data-theme', attr);
      else html.removeAttribute('data-theme');
    }
    const sel = doc.getElementById('theme-select');
    if (sel) sel.value = choice;
  };
  applyTheme(normalizeTheme(storage.get(THEME_KEY)));
  doc.getElementById('theme-select')?.addEventListener('change', (ev) => {
    const choice = normalizeTheme(ev.target.value);
    applyTheme(choice); // the document first, persistence second
    if (choice === 'system') storage.remove(THEME_KEY);
    else storage.set(THEME_KEY, choice);
  });

  const setConn = (s, text) => {
    const c = $('conn');
    if (!c) return;
    c.dataset.state = s;
    $('conn-text').textContent = text;
  };
  const fail = (body) => `<div class="notice">${esc(body?.message ?? body?.error ?? 'request failed')}</div>`;

  // ---- pages
  const rowHtml = (r, warnings) => {
    const link = `#/changes/${encodeURIComponent(r.name)}`;
    if (r.missing) return `<div class="card"><div class="card-head"><span class="name">${esc(r.name)}</span><span class="tag warn">missing</span></div></div>`;
    const arts = Object.entries(r.artifacts).map(([k, v]) => `<span class="tag${v === 'done' ? '' : ' warn'}">${esc(k)}=${esc(v)}</span>`).join(' ');
    return `<div class="card">
      <div class="card-head"><a class="name" href="${link}">${esc(r.name)}</a>
        ${r.current ? `<span class="tag lime">current: ${esc(r.stage ?? '?')}</span>` : ''}
        ${r.stale ? `<span class="tag warn">stale ${r.staleDays}d</span>` : ''}
        ${progressHtml(r.tasks)}</div>
      <div class="row-actions">${arts}${r.deltaSpecs ? `<span class="tag">${r.deltaSpecs} delta spec(s)</span>` : ''}<span class="meta">modified ${when(Date.parse(r.lastModified))}</span></div>
      ${warnings.length ? `<div class="warnings">${warnings.map((w) => `<div>${esc(w)}</div>`).join('')}</div>` : ''}
    </div>`;
  };
  const pageChanges = async () => {
    const { ok, body } = await api('/api/status');
    if (!ok) return fail(body);
    const per = (n) => body.warnings.filter((w) => w.includes(`"${n}"`) || w.includes(` ${n} (`));
    const general = body.warnings.filter((w) => !body.changes.some((r) => per(r.name).includes(w)));
    return `<h1>Changes</h1>
      ${general.length ? `<div class="warnings">${general.map((w) => `<div>${esc(w)}</div>`).join('')}</div>` : ''}
      ${body.changes.length ? `<div class="cards">${body.changes.map((r) => rowHtml(r, per(r.name))).join('')}</div>` : '<p class="empty">no active changes (changes/ is empty or missing)</p>'}`;
  };
  const pageChange = async (name) => {
    const { ok, body } = await api(`/api/changes/${encodeURIComponent(name)}`);
    if (!ok) return `<div class="crumbs"><a href="#/changes">changes</a> / ${esc(name)}</div>${fail(body)}`;
    const v = await api('/api/validate');
    const result = v.ok ? v.body.results.find((r) => r.name === name) : null;
    const files = body.files
      .map(
        (f) =>
          `<li><a href="${fileRoute(f.path)}">${esc(f.path)}</a><span class="tag">${esc(f.kind)}${f.capability ? ` ${esc(f.capability)}` : ''}</span>${
            f.exists ? `<span class="meta">${f.size} B, ${when(f.mtimeMs)}</span>` : '<span class="tag warn">missing</span>'
          }</li>`
      )
      .join('');
    return `<div class="crumbs"><a href="#/changes">changes</a> / ${esc(name)}</div>
      <h1>${esc(name)}</h1>
      ${rowHtml(body.row, [])}
      <div class="panel"><h3>Files</h3><ul class="file-list">${files}</ul></div>
      ${
        result
          ? `<div class="panel"><h3>Validate: ${result.errors.length ? 'FAIL' : 'ok'}</h3>${
              result.errors.length || result.warnings.length
                ? `<div class="warnings">${result.errors.map((e) => `<div>error: ${esc(e)}</div>`).join('')}${result.warnings.map((w) => `<div>warn: ${esc(w)}</div>`).join('')}</div>`
                : '<p class="muted">no errors, no warnings</p>'
            }</div>`
          : ''
      }`;
  };
  const pageSpecs = async (name) => {
    const { ok, body } = await api('/api/specs');
    if (!ok) return fail(body);
    if (name) {
      const cap = body.capabilities.find((c) => c.name === name);
      if (cap) win.location.hash = fileRoute(cap.path);
    }
    if (!body.capabilities.length) return '<h1>Specs</h1><p class="empty">no specs/ directory yet</p>';
    return `<h1>Specs</h1><div class="cards">${body.capabilities
      .map(
        (c) => `<div class="card"><div class="card-head"><a class="name" href="${fileRoute(c.path)}">${esc(c.name)}</a><span class="meta">${esc(c.path)}, ${when(c.mtimeMs)}</span></div>
        ${
          c.requirements.length
            ? `<ul class="req">${c.requirements
                .map((r) => `<li>${esc(r.name)} ${r.via ? `<a class="via" href="#/archive/${encodeURIComponent(r.via)}">via ${esc(r.via)}</a>` : ''}</li>`)
                .join('')}</ul>`
            : '<p class="empty">no requirements</p>'
        }</div>`
      )
      .join('')}</div>`;
  };
  const pageArchive = async (name) => {
    const { ok, body } = await api('/api/archive');
    if (!ok) return fail(body);
    if (!body.entries.length) return '<h1>Archive</h1><p class="empty">nothing archived yet</p>';
    const html = `<h1>Archive</h1><div class="cards">${body.entries
      .map((e) => {
        const dir = e.dir;
        const base = dir.split('/').pop();
        const link = (rel, label) => `<a href="${fileRoute(`${dir}/${rel}`)}">${esc(label)}</a>`;
        return `<div class="card" id="archive-${esc(base)}"${name === base ? ' data-highlight="1"' : ''}>
          <div class="card-head"><span class="name">${esc(e.change)}</span><span class="tag${e.kind === 'abandoned' ? ' warn' : ' lime'}">${esc(e.kind)}</span><span class="meta">${esc(e.date ?? '')}</span></div>
          ${e.reason ? `<p class="muted">reason: ${esc(e.reason)}</p>` : ''}
          <div class="row-actions">${link('proposal.md', 'proposal')} ${link('design.md', 'design')} ${link('tasks.md', 'tasks')}${e.capabilities
            .map((c) => ` ${link(`specs/${c}/spec.md`, `delta: ${c}`)}`)
            .join('')}</div></div>`;
      })
      .join('')}</div>`;
    return html;
  };
  const pageScratch = async () => {
    const { ok, body } = await api('/api/scratch');
    if (!ok) return fail(body);
    const section = (title, items) =>
      `<div class="panel"><h3>${title}</h3>${
        items.length
          ? `<ul class="file-list">${items.map((f) => `<li><a href="${fileRoute(f.path)}">${esc(f.name)}</a><span class="meta">${f.size} B, ${when(f.mtimeMs)}</span></li>`).join('')}</ul>`
          : '<p class="empty">empty</p>'
      }</div>`;
    return `<h1>Scratch <span class="meta">.my-flow/ (read-only)</span></h1>${section('ask', body.ask)}${section('verify', body.verify)}${section('interviews', body.interviews)}`;
  };

  // ---- file view and editor
  const parentOf = (path) => {
    const m = /^changes\/(?!archive\/)([^/]+)\//.exec(path);
    if (m) return { href: `#/changes/${encodeURIComponent(m[1])}`, label: `changes / ${m[1]}` };
    if (path.startsWith('changes/archive/')) return { href: '#/archive', label: 'archive' };
    if (path.startsWith('specs/')) return { href: '#/specs', label: 'specs' };
    return { href: '#/scratch', label: 'scratch' };
  };
  const pageFile = async (path) => {
    const keep = state.editor && state.editor.path === path && state.editor.dirty ? state.editor : null;
    const { ok, body } = await api(`/api/file?path=${encodeURIComponent(path)}`);
    const parent = parentOf(path);
    if (!ok) return `<div class="crumbs"><a href="${parent.href}">${esc(parent.label)}</a> / ${esc(path)}</div>${fail(body)}`;
    const ed = keep ?? { path, content: body.content, mtimeMs: body.mtimeMs, dirty: false, lastSavedMtime: null, notice: null };
    if (keep && keep.mtimeMs !== body.mtimeMs && !isOwnEcho(keep.lastSavedMtime, body.mtimeMs)) ed.notice = { kind: 'disk', content: body.content, mtimeMs: body.mtimeMs };
    state.editor = ed;
    return `<div class="crumbs"><a href="${parent.href}">${esc(parent.label)}</a> / ${esc(path)}</div>
      <div class="row-actions"><span class="tag">${body.eol}</span><span class="tag${body.writable ? ' lime' : ''}">${body.writable ? 'editable' : 'read-only'}</span><span class="meta">${when(body.mtimeMs)}</span>
        ${body.writable ? '<button id="save" class="primary">Save</button><button id="reload">Reload</button>' : ''}</div>
      ${body.lockReason ? `<div class="notice lock">${esc(body.lockReason)}</div>` : ''}
      <div id="notice"></div>
      <div class="editor">
        ${body.writable ? `<textarea id="ta" spellcheck="false"></textarea>` : ''}
        <div class="preview md" id="preview"></div>
      </div>`;
  };
  const noticeHtml = (n) => {
    if (!n) return '';
    if (n.kind === 'disk') return `<div class="notice">This file changed on disk while you were editing. <button id="n-reload">Reload from disk</button> <button id="n-keep">Keep my version</button></div>`;
    if (n.kind === 'conflict') return `<div class="notice">Save refused: the file changed on disk since it was loaded. <button id="n-reload">Reload from disk</button> <button id="n-force">Overwrite</button></div>`;
    if (n.kind === 'saved') return `<div class="notice ok">Saved (${esc(n.eol)}).</div>`;
    if (n.kind === 'error') return `<div class="notice">${esc(n.message)}</div>`;
    return '';
  };
  /** Binds the editor once per page render; repaints go through state.paintEditor. */
  const wireEditor = () => {
    const ed = state.editor;
    const ta = $('ta');
    const preview = $('preview');
    if (!ed || !preview) return;
    const paint = () => {
      preview.innerHTML = renderMarkdown(ta ? ta.value : ed.content);
      $('notice').innerHTML = noticeHtml(ed.notice);
      const save = $('save');
      if (save) save.disabled = !ed.dirty;
      $('n-reload')?.addEventListener('click', () => {
        const n = ed.notice;
        ed.content = n?.content ?? ed.content;
        ed.mtimeMs = n?.mtimeMs ?? ed.mtimeMs;
        ed.dirty = false;
        ed.notice = null;
        if (ta) ta.value = ed.content;
        paint();
      });
      $('n-keep')?.addEventListener('click', () => {
        ed.mtimeMs = ed.notice?.mtimeMs ?? ed.mtimeMs;
        ed.notice = null;
        paint();
      });
      $('n-force')?.addEventListener('click', () => doSave(true));
    };
    const doSave = async (force) => {
      const r = await api('/api/file', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: ed.path, content: ta.value, mtimeMs: ed.mtimeMs, force: !!force }),
      });
      if (r.status === 409) {
        ed.notice = { kind: 'conflict', content: r.body.content, mtimeMs: r.body.mtimeMs };
      } else if (r.ok) {
        ed.content = ta.value;
        ed.mtimeMs = r.body.mtimeMs;
        ed.lastSavedMtime = r.body.mtimeMs;
        ed.dirty = false;
        ed.notice = { kind: 'saved', eol: r.body.eol };
      } else ed.notice = { kind: 'error', message: r.body.message ?? r.body.error };
      paint();
    };
    state.paintEditor = paint;
    if (ta) {
      ta.value = ed.content;
      ta.addEventListener('input', () => {
        ed.dirty = ta.value !== ed.content;
        if (ed.notice?.kind === 'saved') ed.notice = null;
        paint();
      });
      $('save')?.addEventListener('click', () => doSave(false));
      $('reload')?.addEventListener('click', async () => {
        const r = await api(`/api/file?path=${encodeURIComponent(ed.path)}`);
        if (r.ok) {
          ed.content = r.body.content;
          ed.mtimeMs = r.body.mtimeMs;
          ed.dirty = false;
          ed.notice = null;
          ta.value = ed.content;
          paint();
        }
      });
    }
    paint();
  };

  // ---- diff page (design D11)
  const patchHtml = (parsed) =>
    `<div class="patch">${parsed.hunks
      .map(
        (h) =>
          `<div class="row hunk"><span class="no"></span><span class="no"></span><span class="txt">${esc(h.header)}</span></div>` +
          h.lines.map((l) => `<div class="row ${l.kind}"><span class="no">${l.oldNo ?? ''}</span><span class="no">${l.newNo ?? ''}</span><span class="txt">${esc(l.text)}</span></div>`).join('')
      )
      .join('')}</div>`;
  const pageDiff = async (path, out) => {
    if (!state.git) {
      out.order = [];
      return '<h1>Diff</h1><p class="empty">this project root is not inside a git work tree, so there is no diff to show</p>';
    }
    const { ok, body } = await api('/api/diff');
    if (!ok) {
      out.order = [];
      return `<h1>Diff</h1>${fail(body)}`;
    }
    const view = storage.get(DIFF_VIEW_KEY) === 'list' ? 'list' : 'tree';
    const fileRow = (f) =>
      `<li class="file${f.path === path ? ' selected' : ''}"><a href="#/diff/${encodeURIComponent(f.path)}"><span class="tag st">${esc(f.status)}</span>${f.path === latest ? `<span class="tag latest" title="most recently modified, ${esc(when(f.mtimeMs))}">●</span>` : ''} ${esc(view === 'tree' ? f.path.split('/').pop() : f.path)}</a>` +
      `<span class="meta">${f.binary ? 'binary' : f.added !== null ? `+${f.added} -${f.deleted}` : 'new'}</span></li>`;
    const dirHtml = (d) => {
      const closed = state.diffClosed.has(d.path);
      return `<li class="dir${closed ? ' closed' : ''}"><button type="button" class="dir-toggle" data-dir="${esc(d.path)}" aria-expanded="${!closed}">${esc(d.name)}/</button><ul>${d.dirs.map(dirHtml).join('')}${d.files.map(fileRow).join('')}</ul></li>`;
    };
    const tree = buildTree(body.files);
    const ordered = view === 'tree' ? flattenTree(tree) : body.files;
    out.order = ordered;
    const latest = diffNav(ordered, null).latest;
    const left = view === 'tree' ? `<ul class="diff-tree">${tree.dirs.map(dirHtml).join('')}${tree.files.map(fileRow).join('')}</ul>` : `<ul class="diff-tree flat">${body.files.map(fileRow).join('')}</ul>`;
    let right = '<p class="empty">select a file on the left</p>';
    if (path) {
      const entry = body.files.find((f) => f.path === path);
      if (!entry) right = `<p class="empty">${esc(path)} is not among the changed files</p>`;
      else {
        const r = await api(`/api/diff/file?path=${encodeURIComponent(path)}`);
        let bodyHtml;
        if (!r.ok) bodyHtml = fail(r.body);
        else if (r.body.binary) bodyHtml = '<p class="empty">binary file, not rendered</p>';
        else if (r.body.truncated) bodyHtml = '<p class="empty">patch too large to render</p>';
        else if (r.body.skipped) bodyHtml = `<p class="empty">not rendered (${esc(r.body.skipped)})</p>`;
        else bodyHtml = patchHtml(parseUnifiedDiff(r.body.patch));
        right = `<div class="patch-head"><span class="tag st">${esc(entry.status)}</span> <span class="mono">${esc(entry.oldPath ? `${entry.oldPath} -> ${entry.path}` : entry.path)}</span></div>${bodyHtml}`;
      }
    }
    return `<h1>Diff <span class="meta">working tree vs ${esc(body.base)}${body.head ? ` (${esc(body.head.slice(0, 7))})` : ''}</span></h1>
      <div class="row-actions"><button type="button" id="diff-view" aria-pressed="${view === 'list'}">${view === 'tree' ? 'Flat list' : 'Tree'}</button><button type="button" id="diff-refresh">Refresh</button><span class="meta"><span class="tag">j</span> next <span class="tag">k</span> previous <span class="tag">.</span> latest</span>
        <span class="meta">${body.files.length} changed file(s); auto-refresh covers specs/, changes/ and .my-flow/ only</span></div>
      <div class="diff"><div class="diff-left">${body.files.length ? left : '<p class="empty">no changes against HEAD</p>'}</div><div class="diff-right">${right}</div></div>`;
  };
  const wireDiff = () => {
    $('diff-view')?.addEventListener('click', () => {
      storage.set(DIFF_VIEW_KEY, storage.get(DIFF_VIEW_KEY) === 'list' ? 'tree' : 'list');
      render();
    });
    $('diff-refresh')?.addEventListener('click', () => render());
    for (const b of doc.querySelectorAll('.dir-toggle')) {
      b.addEventListener('click', () => {
        const dir = b.dataset.dir;
        if (state.diffClosed.has(dir)) state.diffClosed.delete(dir);
        else state.diffClosed.add(dir);
        const li = b.parentElement;
        li.classList.toggle('closed', state.diffClosed.has(dir));
        b.setAttribute('aria-expanded', String(!state.diffClosed.has(dir)));
      });
    }
    // keyboard shortcuts (design D9): j next, k previous, . latest; bound here, unbound at the next commit
    const onKey = (ev) => {
      if (ev.ctrlKey || ev.altKey || ev.metaKey || ev.isComposing) return;
      if (state.route.page !== 'diff') return;
      const t = ev.target;
      const tag = t && t.tagName ? t.tagName : '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
      const nav = diffNav(state.diffOrder ?? [], state.route.path);
      const target = ev.key === 'j' ? nav.next : ev.key === 'k' ? nav.prev : ev.key === '.' ? nav.latest : null;
      if (!target) return;
      ev.preventDefault();
      for (const d of ancestorDirs(target)) state.diffClosed.delete(d);
      win.location.hash = `#/diff/${encodeURIComponent(target)}`;
    };
    doc.addEventListener('keydown', onKey);
    state.unbindDiffKeys = () => doc.removeEventListener('keydown', onKey);
  };

  // ---- render loop
  let rendering = null;
  const render = async () => {
    const route = (state.route = parseRoute(win.location.hash));
    for (const a of doc.querySelectorAll('[data-nav]')) a.classList.toggle('active', a.dataset.nav === route.page || (route.page === 'file' && a.dataset.nav === parentOf(route.path ?? '').label.split(' ')[0]));
    if (route.page !== 'file') state.editor = null;
    state.paintEditor = null;
    const out = {};
    const job = (async () => {
      try {
        if (route.page === 'changes') return route.name ? pageChange(route.name) : pageChanges();
        if (route.page === 'specs') return pageSpecs(route.name);
        if (route.page === 'archive') return pageArchive(route.name);
        if (route.page === 'scratch') return pageScratch();
        if (route.page === 'file') return pageFile(route.path);
        if (route.page === 'diff') return pageDiff(route.path, out);
        return pageChanges();
      } catch (e) {
        return `<div class="notice">${esc(e.message)}</div>`;
      }
    })();
    rendering = job;
    const html = await job;
    if (rendering !== job) return; // a newer render superseded this one
    state.unbindDiffKeys?.();
    state.unbindDiffKeys = null;
    state.diffOrder = out.order ?? [];
    view.classList.toggle('wide', route.page === 'diff');
    view.innerHTML = html;
    if (route.page === 'file') wireEditor();
    if (route.page === 'diff') wireDiff();
    if (route.page === 'diff') doc.querySelector('.diff-left li.file.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (route.page === 'archive' && route.name) doc.getElementById(`archive-${route.name}`)?.classList.add('highlight');
  };

  // ---- live updates
  const onChange = async (paths) => {
    const route = state.route;
    if (!shouldRefetch(route, paths)) return;
    if (route.page === 'file' && state.editor && paths.includes(route.path)) {
      const r = await api(`/api/file?path=${encodeURIComponent(route.path)}`);
      if (!r.ok) return render();
      const ed = state.editor;
      if (r.body.mtimeMs === ed.mtimeMs || isOwnEcho(ed.lastSavedMtime, r.body.mtimeMs)) return; // nothing new, or our own save
      if (ed.dirty) {
        // keep the user's typing; only the notice changes
        ed.notice = { kind: 'disk', content: r.body.content, mtimeMs: r.body.mtimeMs };
      } else {
        ed.content = r.body.content;
        ed.mtimeMs = r.body.mtimeMs;
        const ta = $('ta');
        if (ta) ta.value = ed.content;
      }
      state.paintEditor?.();
      return;
    }
    render();
  };
  const connect = () => {
    const es = new win.EventSource('/api/events');
    state.es = es;
    es.addEventListener('hello', (ev) => {
      const hello = JSON.parse(ev.data);
      setConn('live', `live, port ${hello.port}`);
      if (state.root && state.root !== hello.root) return win.location.reload(); // a different project answered
      state.root = hello.root;
      state.git = hello.git === true;
      const navDiff = $('nav-diff');
      if (navDiff) navDiff.hidden = !state.git; // the Diff entry exists only where git does
      const label = $('root-label');
      if (label) label.textContent = hello.root;
      render(); // every hello, including reconnects: events during the gap are gone
    });
    es.addEventListener('change', (ev) => onChange(JSON.parse(ev.data).paths ?? []));
    es.onerror = () => setConn('reconnecting', 'reconnecting');
  };

  win.addEventListener('hashchange', render);
  if (!win.location.hash) win.location.hash = '#/changes';
  connect();
  return { render, state };
}

if (typeof document !== 'undefined' && typeof document.getElementById === 'function' && document.getElementById('view')) boot();

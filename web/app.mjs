/**
 * my-flow dashboard client (design D9): hash router, four pages, one file editor, and an
 * EventSource client that refetches only what the current route needs.
 *
 * Exports the pure pieces (route parsing, refetch decision, echo check) so `node --test` can
 * exercise them without a DOM; `boot()` runs only when the shell is present.
 */
import { escapeHtml as esc, renderMarkdown } from './md.mjs';
import { mountListbox } from './ui.mjs';

// ---------------------------------------------------------------- pure helpers
/** '#/changes/demo' -> { page: 'changes', name: 'demo' }; '#/file/<enc>' -> { page: 'file', path } */
export const REFERENCE_TYPES = ['task', 'acceptance', 'design', 'evidence'];
/** `#/change/<uuid>/<type>/<id>` (contract C-02), plus the evidence acceptance subroute. */
export const changeRoute = (ref, type, id, sub) => {
  const base = `#/change/${encodeURIComponent(ref)}`;
  if (!type) return base;
  const one = `${base}/${type}/${encodeURIComponent(id)}`;
  return sub ? `${one}/${sub.type}/${encodeURIComponent(sub.id)}` : one;
};

export function parseRoute(hash) {
  let parts;
  try {
    parts = (hash || '#/changes').replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    // malformed percent encoding never reaches a resolver, and never renders anything of its own
    return { page: 'invalid', reason: 'this link is not a valid reference (malformed percent encoding)' };
  }
  const [page = 'changes', ...rest] = parts;
  if (page === 'change') {
    const [ref, type, id, subType, subId] = rest;
    if (!ref) return { page: 'changes', name: null };
    if (!type) return { page: 'change', ref, type: null, id: null, sub: null };
    if (!REFERENCE_TYPES.includes(type) || !id) return { page: 'invalid', reason: `"${type}" is not one of ${REFERENCE_TYPES.join(', ')}` };
    if (subType === undefined) return { page: 'change', ref, type, id, sub: null };
    if (type !== 'evidence' || subType !== 'acceptance' || !subId) return { page: 'invalid', reason: 'only an evidence attempt has an acceptance subroute' };
    return { page: 'change', ref, type, id, sub: { type: 'acceptance', id: subId } };
  }
  if (page === 'file') return { page, path: rest.join('/') };
  if (page === 'diff') return { page, path: rest.length ? rest.join('/') : null };
  if (page === 'changes') return { page, name: rest[0] ?? null };
  if (page === 'specs') return { page, name: rest[0] ?? null };
  if (page === 'archive') return { page, name: rest[0] ?? null };
  if (page === 'scratch') return { page };
  if (page === 'styleguide') return { page };
  return { page: 'changes', name: null };
}
export const fileRoute = (path) => `#/file/${encodeURIComponent(path)}`;

/**
 * A task line reads `<action> and verify <observable result>`. The row shows those two halves;
 * everything technical (which suite, which historical note) lives behind the row's details.
 * A line that does not use the phrase keeps its whole text as the action.
 */
export function splitTaskTitle(title) {
  const m = /^(.*?)\s+and verif(?:y|ies|ied)\b\s*(.*)$/i.exec(String(title ?? ''));
  return m ? { action: m[1].trim(), result: m[2].trim() } : { action: String(title ?? '').trim(), result: '' };
}
/** Readiness to the existing tag tones, so the row needs no colour vocabulary of its own. */
export function readinessTone(readiness) {
  if (readiness === 'complete' || readiness === 'ready') return 'lime';
  if (readiness === 'blocked' || readiness === 'invalid') return 'warn';
  return 'plain';
}
/** In-page anchor for one typed reference inside the change being viewed. */
export const anchorFor = (type, id) => `${type === 'acceptance' ? 'ac' : type === 'design' ? 'd' : type}-${id}`;
/** The word a reader understands, for each reference field. */
export const REF_LABELS = { 'depends-on': 'needs', accepts: 'accepts', design: 'design', evidence: 'evidence' };

// ---- tasks (design D1, D2): a concise row, with every detail one labelled link away
export const refItemHtml = (ref, changeId = null) => {
  const label = REF_LABELS[ref.field] ?? ref.field;
  const target = ref.label ? `${ref.id} — ${ref.label}` : ref.id;
  const link =
    ref.resolved === false
      ? `<span class="tag warn">${esc(ref.id)} does not resolve</span>`
      : `<a href="${esc(changeId ? changeRoute(changeId, ref.type, ref.id) : '#' + anchorFor(ref.type, ref.id))}">${esc(target)}</a>`;
  return `<li><span class="ref-label">${esc(label)}</span>${link}</li>`;
};
export const taskRowHtml = (t, changeId = null) => {
  const { action, result } = splitTaskTitle(t.title);
  const tone = readinessTone(t.readiness);
  const badge = tone === 'lime' ? 'tag lime' : tone === 'warn' ? 'tag warn' : 'tag';
  const refs = [...t.outgoing.map((r) => refItemHtml(r, changeId)), ...t.incoming.map((i) => refItemHtml({ ...i, id: i.from, type: 'task', field: 'needed by' }, changeId))];
  return `<li class="task-row" id="${esc(anchorFor('task', t.id ?? t.number))}">
    <div class="task-head">
      <span class="box" aria-hidden="true">${t.checked ? '&#9745;' : '&#9744;'}</span>
      <span class="meta">${esc(t.number)}</span>
      <span class="task-action">${esc(action)}</span>
      <span class="${badge}">${esc(t.readiness)}</span>
    </div>
    ${result ? `<div class="task-result">verify: ${esc(result)}</div>` : ''}
    <details class="task-detail"><summary>${esc(t.id ?? 'no stable id')}</summary>
      ${t.reasons.length ? `<p class="task-why">${esc(t.reasons.join('; '))}</p>` : ''}
      ${t.blocked ? `<div class="warnings"><div>blocked: ${esc(t.blocked)}</div></div>` : ''}
      ${refs.length ? `<ul class="refs">${refs.join('')}</ul>` : '<p class="muted">no declared references</p>'}
      ${t.notes.length ? `<ul class="refs">${t.notes.map((n) => `<li><span class="ref-label">note</span>${esc(n)}</li>`).join('')}</ul>` : ''}
    </details></li>`;
};
export const tasksPanelHtml = (intent, changeId = null) => {
  if (!intent) return '';
  const criteria = intent.acceptance
    .map(
      (c) => `<li id="${esc(anchorFor('acceptance', c.id))}"><span class="ref-label">${esc(c.id)}</span>${esc(c.title)}
      <span class="meta">${esc((c.evidenceModes ?? []).join(', ') || 'no evidence mode declared')}${c.required ? '' : ', optional'}</span>
      ${c.checks ? `<div class="task-result">checks: ${esc(c.checks)}</div>` : ''}</li>`
    )
    .join('');
  const decisions = intent.design.map((d) => `<li id="${esc(anchorFor('design', d.id))}"><span class="ref-label">${esc(d.id)}</span>${esc(d.title)}</li>`).join('');
  return `<div class="panel"><h3>Tasks <span class="meta">${intent.counts.done}/${intent.counts.total} ticked, schema v${intent.schemaVersion}</span></h3>
      ${intent.tasks.length ? `<ul class="tasks">${intent.tasks.map((t) => taskRowHtml(t, changeId)).join('')}</ul>` : '<p class="empty">no tasks yet</p>'}</div>
    ${criteria ? `<div class="panel"><h3>Acceptance</h3><ul class="refs">${criteria}</ul></div>` : ''}
    ${decisions ? `<div class="panel"><h3>Design decisions</h3><ul class="refs">${decisions}</ul></div>` : ''}`;
};

/**
 * The breadcrumb trail of a stable reference. Identity first, so a link stays meaningful after
 * the change is renamed, renumbered or archived; the display name is read from the target.
 */
export const changeCrumbsHtml = (identity, location, type, id) => {
  const home = `<a href="#/changes">changes</a>`;
  const self = `<a href="${esc(changeRoute(identity.id ?? identity.slug))}">${esc(identity.slug)}</a>`;
  const where = location.location === 'archive' ? `<span class="tag">archived</span>` : '';
  const leaf = type ? ` / <span class="meta">${esc(type)}</span> ${esc(id)}` : '';
  return `<div class="crumbs">${home} / ${self}${leaf} ${where}</div>`;
};

/** Diagnostics as the existing warnings block; every entry names its code and its source. */
export const diagnosticsHtml = (diagnostics) => {
  if (!diagnostics?.length) return '';
  return `<div class="warnings">${diagnostics
    .map((d) => `<div>${esc(d.severity ?? 'error')}: ${esc(d.code)}: ${esc(d.message)}${d.path ? ` (${esc(d.path)}${d.line ? `:${d.line}` : ''})` : ''}</div>`)
    .join('')}</div>`;
};


/**
 * The durable verification head, and every attempt on disk. The head is what decides: an open or
 * reserved attempt blocks an older PASS, and the reasons are shown rather than summarised away.
 */
export const verificationPanelHtml = (verification, changeId) => {
  if (!verification) return '';
  const { head, eligible, reasons, attempts, missingOlder } = verification;
  const badge = eligible ? 'tag lime' : 'tag warn';
  const headLine = head ? `${head.sequence ? `V-${head.sequence}` : 'V-?'} ${head.state}${head.verdict ? ` ${head.verdict}` : ''}` : 'no attempt started';
  const rows = (attempts ?? [])
    .map((a) => {
      const tone = a.verdict === 'PASS' && a.qualified ? 'tag lime' : a.verdict ? 'tag warn' : 'tag';
      return `<li><span class="ref-label">${esc(a.id)}</span>
        <a href="${esc(changeRoute(changeId, 'evidence', a.id))}">${esc(a.verdict ?? 'incomplete')}${a.cancelled ? ' (cancelled)' : ''}</a>
        <span class="${tone}">${esc(a.qualified ? 'independent' : 'unqualified')}</span>
        <span class="meta">${esc(a.started ?? '')}</span></li>`;
    })
    .join('');
  return `<div class="panel"><h3>Verification <span class="${badge}">${eligible ? 'eligible' : 'not eligible'}</span></h3>
    <p class="meta">head: ${esc(headLine)}; high-water ${esc(String(verification.highWater ?? 'unknown'))}</p>
    ${verification.corrupt ? '<div class="warnings"><div>the verification metadata is corrupt; it is never repaired by scanning for an older PASS</div></div>' : ''}
    ${reasons?.length ? `<div class="warnings">${reasons.map((r) => `<div>${esc(r)}</div>`).join('')}</div>` : ''}
    ${missingOlder?.length ? `<p class="muted">older attempt(s) no longer on disk: ${esc(missingOlder.join(', '))}</p>` : ''}
    ${rows ? `<ul class="refs">${rows}</ul>` : '<p class="empty">no attempts recorded</p>'}</div>`;
};

/**
 * Umbrella children: derived state, shown separately from this umbrella own integration
 * verification. A child being finished is information, never a reason to tick a box here.
 */
export const umbrellaPanelHtml = (umbrella) => {
  if (!umbrella) return '';
  const rows = umbrella.children
    .map((c) => {
      const where = c.repo === 'self' ? 'this repository' : `repository \"${c.repo}\"`;
      if (!c.resolved) {
        return `<li><span class=\"ref-label\">${esc(where)}</span><span class=\"tag warn\">unresolved</span> <span class=\"meta\">${esc(c.reason ?? '')}</span></li>`;
      }
      const t = c.state.tasks;
      const finished = t && t.total > 0 && t.done === t.total && !c.state.abandoned;
      return `<li><span class=\"ref-label\">${esc(where)}</span>${esc(c.state.slug)}
        <span class=\"${c.state.abandoned ? 'tag warn' : finished ? 'tag lime' : 'tag'}\">${esc(c.state.abandoned ? 'abandoned' : c.state.stage ?? 'unknown')}</span>
        <span class=\"meta\">${t ? `${t.done}/${t.total} tasks` : 'no tasks.md'}</span></li>`;
    })
    .join('');
  return `<div class=\"panel\"><h3>Children <span class=\"meta\">${umbrella.derived.complete}/${umbrella.derived.total} finished, ${umbrella.derived.resolved} resolved</span></h3>
    <p class=\"muted\">${esc(umbrella.note)}</p>
    ${umbrella.blockers.length ? `<div class=\"warnings\">${umbrella.blockers.map((b) => `<div>${esc(b.message)}</div>`).join('')}</div>` : ''}
    ${rows ? `<ul class=\"refs\">${rows}</ul>` : '<p class=\"empty\">no children declared</p>'}</div>`;
};
/** Spec-base conflicts, each with the three texts a reader needs in order to decide. */
export const specBasePanelHtml = (specBase) => {
  if (!specBase) return '';
  const { conflicts, diagnostics } = specBase;
  if (!conflicts?.length && !diagnostics?.length) {
    return `<div class="panel"><h3>Spec base</h3><p class="muted">${specBase.entries} requirement base(s) captured${specBase.capturedAt ? ` at ${esc(specBase.capturedAt)}` : ''}; every claim still matches.</p></div>`;
  }
  const three = (label, text, absent) => `<div class="task-result">${label}: ${text === null ? absent : esc(text.split('\n')[0])}</div>`;
  return `<div class="panel"><h3>Spec base <span class="tag warn">${(conflicts ?? []).length} conflict(s)</span></h3>
    ${diagnostics?.length ? `<div class="warnings">${diagnostics.map((d) => `<div>${esc(d.message)}</div>`).join('')}</div>` : ''}
    ${(conflicts ?? [])
      .map(
        (c) => `<div class="task-row"><div class="task-head"><span class="ref-label">${esc(c.operation)}</span><span class="task-action">${esc(c.capability)} / ${esc(c.requirement)}</span></div>
        <p class="task-why">${esc(c.reason)}</p>
        ${three('base', c.base, '(absent)')}${three('current', c.current, '(absent)')}${three('proposed', c.proposed, '(removal)')}</div>`
      )
      .join('')}</div>`;
};

/** One recorded attempt: what it was opened against, what it found, and what it copied. */
export const attemptViewHtml = (a, changeId) => {
  const tone = a.verdict === 'PASS' && a.qualified ? 'tag lime' : a.verdict ? 'tag warn' : 'tag';
  const criteria = (a.criteria ?? [])
    .map(
      (c) => `<li><span class="ref-label">${esc(c.id)}</span>
      <a href="${esc(changeRoute(changeId, 'evidence', a.id, { type: 'acceptance', id: c.id }))}">${esc(c.status)}</a>
      <span class="meta">${esc((c.modes ?? []).join(', '))}${(c.evidenceRefs ?? []).length ? `; ${esc(c.evidenceRefs.join(', '))}` : '; no evidence named'}</span></li>`
    )
    .join('');
  const commands = (a.commands ?? [])
    .map((c) => `<li><span class="ref-label">exit ${esc(String(c.exitCode))}</span><code>${esc(c.command)}</code> <span class="meta">${esc(c.summary ?? '')}</span></li>`)
    .join('');
  const artifacts = (a.artifacts ?? []).map((x) => `<li><span class="ref-label">artifact</span>${esc(x.relativePath)} <span class="meta">${esc(String(x.bytes ?? ''))} B</span></li>`).join('');
  return `<div class="panel"><h3>${esc(a.id)} <span class="${tone}">${esc(a.verdict ?? 'incomplete')}</span> <span class="tag">${esc(a.qualified ? 'independent' : 'unqualified')}</span></h3>
      <p class="meta">started ${esc(a.started ?? 'unknown')}${a.finished ? `, finished ${esc(a.finished)}` : ', never finished'}</p>
      ${a.cancelled ? `<div class="warnings"><div>cancelled: ${esc(a.cancelled.reason)}</div></div>` : ''}
      ${a.originProblems?.length ? `<div class="warnings">${a.originProblems.map((r) => `<div>${esc(r)}</div>`).join('')}</div>` : ''}
      <div class="task-result">implementation ${esc((a.implementationDigest ?? 'unknown').slice(0, 12))} &middot; acceptance ${esc((a.acceptanceDigest ?? 'unknown').slice(0, 12))}</div>
      ${a.session ? `<div class="task-result">session ${esc(a.session)}</div>` : ''}</div>
    ${criteria ? `<div class="panel"><h3>Criteria</h3><ul class="refs">${criteria}</ul></div>` : ''}
    ${commands ? `<div class="panel"><h3>Commands</h3><ul class="refs">${commands}</ul></div>` : ''}
    ${artifacts ? `<div class="panel"><h3>Artifacts</h3><ul class="refs">${artifacts}</ul></div>` : ''}
    ${
      a.capturedAcceptance
        ? `<div class="panel"><h3>${esc(a.capturedAcceptance.id)} as this attempt captured it</h3>
            <p class="meta">from ${esc(a.capturedAcceptance.capturedFrom)}</p>
            <pre><code>${esc(a.capturedAcceptance.text)}</code></pre></div>`
        : ''
    }`;
};

/**
 * One typed reference: the item itself, then everything that points at it. Reverse dependencies
 * are derived from the declared references of other tasks, never stored, so they cannot go stale.
 */
export const referenceViewHtml = (body) => {
  const { identity, location, type, item } = body;
  const changeId = identity.id ?? identity.slug;
  const incoming = item.incoming ?? [];
  const reverse = incoming.length
    ? `<ul class="refs">${incoming.map((i) => refItemHtml({ ...i, id: i.from, type: 'task', field: type === 'task' ? 'needed by' : 'referenced by' }, changeId)).join('')}</ul>`
    : '<p class="muted">nothing declares a reference to this</p>';
  if (type === 'evidence') {
    return `${changeCrumbsHtml(identity, location, type, item.id)}
      <h1>${esc(item.id)}</h1>
      ${attemptViewHtml(item, changeId)}
      ${diagnosticsHtml(body.diagnostics)}`;
  }
  const head =
    type === 'task'
      ? `<ul class="tasks">${taskRowHtml(item, changeId)}</ul>`
      : type === 'acceptance'
        ? `<div class="panel"><h3>${esc(item.id)} — ${esc(item.title)}</h3>
            <p class="meta">${esc((item.evidenceModes ?? []).join(', ') || 'no evidence mode declared')}${item.required ? ', required' : ', optional'}</p>
            ${item.checks ? `<div class="task-result">checks: ${esc(item.checks)}</div>` : ''}
            ${item.requirements ? `<div class="task-result">requirements: ${esc(item.requirements)}</div>` : ''}</div>`
        : `<div class="panel"><h3>${esc(item.id)} — ${esc(item.title)}</h3></div>`;
  const source = item.path ? `<p class="meta">${esc(item.path)}${item.line ? `:${item.line}` : ''} <a href="${esc(fileRoute(item.path))}">open the file</a></p>` : '';
  return `${changeCrumbsHtml(identity, location, type, item.id)}
    <h1>${esc(item.id)}</h1>
    ${head}
    ${source}
    <div class="panel"><h3>Referenced by</h3>${reverse}</div>
    ${diagnosticsHtml(body.diagnostics)}`;
};


/**
 * One stable string per destination. Two renders of the same destination are the same key, so a
 * live refresh can be told apart from a navigation.
 */
export function routeKey(route) {
  if (!route) return '';
  if (route.page === 'change') return `change:${route.ref}:${route.type ?? ''}:${route.id ?? ''}:${route.sub ? `${route.sub.type}:${route.sub.id}` : ''}`;
  if (route.page === 'file' || route.page === 'diff') return `${route.page}:${route.path ?? ''}`;
  if (route.page === 'invalid') return `invalid:${route.reason}`;
  return `${route.page}:${route.name ?? ''}`;
}
/**
 * Focus moves to the new page's heading when the reader navigated, and never when a
 * Server-Sent Event repainted the page they are already reading: a live update must not steal
 * the caret or the screen-reader cursor.
 */
export const shouldFocusHeading = (previousKey, nextKey) => previousKey !== nextKey;

/** Does a `change` event carrying these root-relative paths affect this route? */
const pathWithin = (path, parent) => typeof path === 'string' && typeof parent === 'string' && (path === parent || path.startsWith(`${parent.replace(/\/$/, '')}/`));
export function shouldRefetch(route, paths) {
  const any = (pred) => paths.some(pred);
  switch (route.page) {
    case 'changes':
      return any((p) => pathWithin(p, 'changes') || pathWithin(p, 'specs') || pathWithin('.my-flow/state/current-change.json', p));
    case 'specs':
      return any((p) => pathWithin(p, 'specs') || pathWithin(p, 'changes'));
    case 'archive':
      return any((p) => pathWithin(p, 'changes/archive') || pathWithin('changes/archive', p));
    case 'scratch':
      return any((p) => pathWithin(p, '.my-flow'));
    case 'change':
      return any((p) => pathWithin(p, 'changes') || pathWithin(p, 'specs') || pathWithin('.my-flow/state/current-change.json', p));
    case 'invalid':
      return false; // a refused link has nothing behind it to refetch
    case 'styleguide':
      return false; // static page, no data behind it
    case 'file':
      // the state file decides the execute lock, so every editor reacts to it
      return any((p) => pathWithin(route.path, p) || pathWithin('.my-flow/state/current-change.json', p));
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
    state.themeBox?.set(choice);
  };
  // Named onThemeChange: boot() already declares const onChange for live updates below.
  const onThemeChange = (value) => {
    const choice = normalizeTheme(value);
    applyTheme(choice); // the document first, persistence second
    if (choice === 'system') storage.remove(THEME_KEY);
    else storage.set(THEME_KEY, choice);
  };
  // Mount before the first apply (design D7), so the trigger label follows the stored choice.
  const themeRoot = $('theme-listbox');
  state.themeBox = themeRoot ? mountListbox(themeRoot, { onChange: onThemeChange }) : null;
  applyTheme(normalizeTheme(storage.get(THEME_KEY)));

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
  /**
   * `#/change/<uuid>` and `#/change/<uuid>/<type>/<id>` (contract C-02). The reference resolves
   * through identity, so the same link keeps working after the tasks are renumbered, the change
   * is renamed, or the whole directory has moved into `changes/archive/`.
   */
  const pageReference = async (route) => {
    const path = route.type
      ? `/api/intent/${encodeURIComponent(route.ref)}/${encodeURIComponent(route.type)}/${encodeURIComponent(route.id)}${
          route.sub ? `/${route.sub.type}/${encodeURIComponent(route.sub.id)}` : ''
        }`
      : `/api/intent/${encodeURIComponent(route.ref)}`;
    const { ok, body } = await api(path);
    const crumbs = `<div class="crumbs"><a href="#/changes">changes</a> / ${esc(route.ref)}</div>`;
    if (!ok) return `${crumbs}${fail(body)}${diagnosticsHtml(body?.diagnostics)}`;
    if (route.type) return referenceViewHtml(body);
    return `${changeCrumbsHtml(body.identity, body.location, null, null)}
      <h1>${esc(body.identity.slug)}</h1>
      <p class="meta">${esc(body.location.rel)} &middot; ${body.counts.done}/${body.counts.total} tasks &middot; ${esc(body.identity.stage ?? 'no lifecycle stage')}</p>
      ${tasksPanelHtml(body, body.identity.id ?? body.identity.slug)}
      ${umbrellaPanelHtml(body.umbrella)}
      ${verificationPanelHtml(body.verification, body.identity.id ?? body.identity.slug)}
      ${specBasePanelHtml(body.specBase)}
      ${diagnosticsHtml(body.diagnostics)}`;
  };

  const pageChange = async (name) => {
    const { ok, body } = await api(`/api/changes/${encodeURIComponent(name)}`);
    if (!ok) return `<div class="crumbs"><a href="#/changes">changes</a> / ${esc(name)}</div>${fail(body)}`;
    const i = await api(`/api/intent/${encodeURIComponent(name)}`);
    const intent = i.ok ? i.body : null;
    const intentNotice = i.ok ? '' : `<div class="notice">${esc(i.body?.message ?? 'the linked task view is unavailable')}</div>`;
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
      ${intentNotice}
      ${tasksPanelHtml(intent, intent?.identity?.id ?? intent?.identity?.slug ?? null)}
      ${umbrellaPanelHtml(intent?.umbrella)}
      ${verificationPanelHtml(intent?.verification, intent?.identity?.id ?? intent?.identity?.slug ?? null)}
      ${specBasePanelHtml(intent?.specBase)}
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
  // ---- styleguide (design D8): every component and state side by side, static HTML, no api()
  const sgItem = (cap, html) => `<div class="sg-item">${html}<span class="sg-cap">${esc(cap)}</span></div>`;
  const sgSection = (title, items) => `<section class="sg-section"><h2>${esc(title)}</h2><div class="sg-row">${items.join('')}</div></section>`;
  const sgLabel = (v) => (v === 'system' ? 'Auto (system)' : v === 'light' ? 'Light' : 'Dark');
  const sgListbox = (id, { open = false, value = 'light', active = 'dark', disabled = false } = {}) => {
    const opt = (v) => `<li class="listbox-option" role="option" id="${id}-opt-${v}" data-value="${v}" aria-selected="${value === v}"${open && active === v ? ' data-active="true"' : ''}${disabled && v === 'dark' ? ' aria-disabled="true"' : ''}>${sgLabel(v)}</li>`;
    return `<div class="listbox" id="${id}" data-value="${value}">
      <button type="button" class="listbox-trigger" id="${id}-trigger" role="combobox" aria-haspopup="listbox" aria-expanded="${open}" aria-controls="${id}-menu" aria-labelledby="${id}-label ${id}-trigger"><span class="listbox-value">${sgLabel(value)}</span><span class="listbox-caret" aria-hidden="true">&#9662;</span></button>
      <ul class="listbox-menu" id="${id}-menu" role="listbox" aria-labelledby="${id}-label"${open ? '' : ' hidden'}>${opt('system')}${opt('light')}${opt('dark')}</ul>
    </div>`;
  };
  const pageStyleguide = () => {
    const tokens = ['--paper', '--paper-2', '--ink', '--ink-muted', '--lime', '--danger', '--ok', '--shadow-color', '--pressed-bg', '--pressed-fg']
      .map((t) => sgItem(t, `<span class="sg-swatch" style="background: var(${t})"></span>`));
    const text = [
      sgItem('headings', '<h1 style="margin-top:0">Heading 1</h1><h2>Heading 2</h2><h3>Heading 3</h3><h4>Heading 4</h4>'),
      sgItem('paragraph, link, hovered link, muted, inline code', '<p>Body text with <a href="#/styleguide">a link</a>, <a href="#/styleguide" class="sg-hover">a hovered link</a>, <span class="muted">muted text</span> and <code>inline code</code>.</p>'),
      sgItem('breadcrumbs', '<div class="crumbs"><a href="#/changes">changes</a> / demo / design.md</div>'),
      sgItem('meta, mono, empty', '<span class="meta">1234 B, 2026-09-10 12:00</span><br><span class="mono">mono text</span><br><span class="empty">nothing here</span>'),
    ];
    const variants = [['default', ''], ['primary', ' primary'], ['neutral', ' neutral'], ['reverse', ' reverse'], ['icon', ' icon']];
    const states = [['rest', ''], ['hover', ' sg-hover'], ['pressed', ' sg-active'], ['focus', ' sg-focus'], ['disabled', '']];
    const buttons = [];
    for (const [v, vc] of variants) {
      for (const [s, sc] of states) {
        const label = v === 'icon' ? '&#9881;' : `${v} ${s}`;
        buttons.push(sgItem(`button ${v} ${s}`, `<button type="button" class="btn${vc}${sc}"${s === 'disabled' ? ' disabled' : ''}>${label}</button>`));
      }
    }
    buttons.push(sgItem('a.btn (link styled as a button)', '<a class="btn" href="#/styleguide">link button</a>'));
    buttons.push(sgItem('variants side by side', '<span class="row-actions"><button type="button" class="btn">default</button><button type="button" class="btn primary">primary</button><button type="button" class="btn neutral">neutral</button><button type="button" class="btn reverse">reverse</button><button type="button" class="btn icon">&#9881;</button><button type="button" class="btn sg-active">pressed</button></span>'));
    const nav = [sgItem('nav tiles: rest, hover, active', '<ul class="nav-list" style="width:160px"><li><a href="#/styleguide">Rest</a></li><li><a href="#/styleguide" class="sg-hover">Hover</a></li><li><a href="#/styleguide" class="active">Active</a></li></ul>')];
    const tags = [
      sgItem('tag plain / lime / warn / st / latest', '<span class="tag">plain</span> <span class="tag lime">lime</span> <span class="tag warn">warn</span> <span class="tag st">M</span> <span class="tag latest">&#9679;</span>'),
      sgItem('provenance link (via)', '<div class="md"><a class="via" href="#/archive">via 2026-09-09-web-dashboard</a></div>'),
      sgItem('connection dot: live / reconnecting', '<span class="conn mono" data-state="live"><span class="conn-dot"></span>live</span> <span class="conn mono" data-state="reconnecting" style="margin-left:12px"><span class="conn-dot"></span>reconnecting</span>'),
    ];
    const surfaces = [
      sgItem('card', '<div class="cards" style="width:280px"><div class="card"><div class="card-head"><span class="name">demo-change</span><span class="tag lime">current: execute</span></div><div class="row-actions"><span class="tag">proposal=done</span><span class="meta">modified 2026-09-10</span></div></div></div>'),
      sgItem('panel', '<div class="panel" style="width:280px"><h3>Panel</h3><ul class="file-list"><li><a href="#/styleguide">changes/demo/design.md</a><span class="tag">design</span></li></ul></div>'),
      sgItem('notice / notice.ok / notice.lock', '<div style="width:280px"><div class="notice">something went wrong</div><div class="notice ok">saved</div><div class="notice lock">read-only while an agent is writing</div></div>'),
      sgItem('warnings', '<div class="warnings" style="width:280px"><div>stale: untouched for 31 days</div><div>overlap: requirement claimed twice</div></div>'),
      sgItem('highlight', '<div class="card highlight" style="width:200px">highlighted card</div>'),
    ];
    const progress = [0, 50, 100].map((p) => sgItem(`progress ${p}%`, `<span class="progress"><span class="bar"><span class="fill" style="width:${p}%"></span></span><span class="mono">${p}/100</span></span>`));
    const tables = [
      sgItem('narrow table', '<div class="md"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div>'),
      sgItem('wide table (scrolls inside itself)', '<div class="md" style="width:420px"><table><thead><tr><th>column</th><th>column</th><th>column</th><th>column</th><th>column</th><th>column</th></tr></thead><tbody><tr><td>unbreakable_xxxxxxxxxxxxxxxxxxxx</td><td>unbreakable_xxxxxxxxxxxxxxxxxxxx</td><td>unbreakable_xxxxxxxxxxxxxxxxxxxx</td><td>unbreakable_xxxxxxxxxxxxxxxxxxxx</td><td>unbreakable_xxxxxxxxxxxxxxxxxxxx</td><td>unbreakable_xxxxxxxxxxxxxxxxxxxx</td></tr></tbody></table></div>'),
      sgItem('hr', '<div style="width:200px"><hr></div>'),
    ];
    const code = [
      sgItem('code block', '<pre style="width:320px"><code>const answer = 42;\nexport default answer; // a long line that scrolls inside the block instead of wrapping the page\n</code></pre>'),
      sgItem('code block with line numbers', '<pre style="width:320px"><span class="line-number"><span>1</span><span>2</span><span>3</span></span><code>import x from "y";\nconst z = x + 1;\nexport { z };\n</code></pre>'),
    ];
    const tasks = [sgItem('task list: open, done', '<div class="md"><ul><li class="task open"><span class="box" aria-hidden="true">&#9744;</span> 1.1 an open task</li><li class="task done"><span class="box" aria-hidden="true">&#9745;</span> 1.2 a done task</li><li>a plain bullet</li></ul></div>')];
    // Linked rows rendered by the real functions, so the styleguide cannot drift from the page.
    const sgTask = (over) => ({
      id: 'T-01', number: '1.1', title: 'Parse stable task fields and verify the graph parsing fixtures',
      checked: false, kind: 'work', blocked: null, readiness: 'ready', reasons: ['no prerequisites'],
      line: 5, endLine: 9, path: 'changes/demo/tasks.md', notes: [], outgoing: [], incoming: [], ...over,
    });
    const linked = [
      sgItem(
        'linked task rows: ready, complete, waiting, blocked, unresolved',
        `<div class="panel"><ul class="tasks">${[
          taskRowHtml(sgTask({ outgoing: [{ type: 'acceptance', id: 'AC-01', field: 'accepts', resolved: true, label: 'Readable task entry' }], incoming: [{ type: 'task', from: 'T-02', field: 'depends-on', label: 'Resolve typed references' }] })),
          taskRowHtml(sgTask({ id: 'T-02', number: '1.2', checked: true, readiness: 'complete', reasons: ['every declared prerequisite is complete'], title: 'Resolve typed references and verify the edge cases' })),
          taskRowHtml(sgTask({ id: 'T-03', number: '1.3', readiness: 'waiting', reasons: ['waiting for T-02'], title: 'Add change identities and verify the lookup fixtures' })),
          taskRowHtml(sgTask({ id: 'T-04', number: '1.4', readiness: 'blocked', blocked: 'the host profile is unauthenticated', reasons: ['blocked: the host profile is unauthenticated'], title: 'Preflight both live hosts and verify the goal handoff' })),
          taskRowHtml(sgTask({ id: 'T-05', number: '1.5', readiness: 'invalid', reasons: ['a typed reference does not resolve'], outgoing: [{ type: 'task', id: 'T-GONE', field: 'depends-on', resolved: false, label: null }] })),
        ].join('')}</ul></div>`
      ),
      sgItem(
        'highlighted reference target, and a row that must not overflow the page',
        `<div class="panel"><ul class="tasks">${taskRowHtml(
          sgTask({ id: 'T-06', number: '1.6', title: 'Handle an unbreakable identifier averylongunbreakableidentifier_that_keeps_going_and_going_and_going and verify averylongunbreakableresult_that_keeps_going_and_going_too', notes: ['a_note_with_one_unbreakable_token_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] })
        ).replace('class="task-row"', 'class="task-row highlight"')}</ul></div>`
      ),
      sgItem('diagnostics', diagnosticsHtml([
        { code: 'unknown-dependency', message: 'task T-02 depends on T-GONE, which no task declares', severity: 'error', path: 'changes/demo/tasks.md', line: 12 },
        { code: 'checked-with-unfinished-prerequisite', message: 'task T-30 is ticked while T-29 is unfinished', severity: 'notice' },
      ])),
    ];
    const tree = [
      sgItem('file tree: open dir, closed dir, hover, selected, latest', '<div class="diff-left" style="width:260px;position:static;max-height:none"><ul class="diff-tree"><li class="dir"><button type="button" class="dir-toggle" aria-expanded="true">web/</button><ul><li class="file"><a href="#/styleguide"><span class="tag st">M</span> app.css</a></li><li class="file sg-hover"><a href="#/styleguide"><span class="tag st">M</span> hovered.mjs</a></li><li class="file selected"><a href="#/styleguide"><span class="tag st">M</span><span class="tag latest">&#9679;</span> selected.mjs</a><span class="meta">+3 -1</span></li></ul></li><li class="dir closed"><button type="button" class="dir-toggle" aria-expanded="false">test/</button><ul><li class="file"><a href="#/styleguide">hidden.mjs</a></li></ul></li></ul></div>'),
      sgItem('flat list', '<div class="diff-left" style="width:260px;position:static;max-height:none"><ul class="diff-tree flat"><li class="file"><a href="#/styleguide"><span class="tag st">?</span> web/ui.mjs</a></li><li class="file"><a href="#/styleguide"><span class="tag st">D</span> old/file.md</a></li></ul></div>'),
    ];
    const patch = [sgItem('patch: hunk, add, del, ctx, meta', '<div class="diff-right" style="width:420px"><div class="patch-head"><span class="mono">web/app.css</span><span class="tag st">M</span><span class="meta">+2 -1</span></div><div class="patch"><div class="row hunk"><span class="no"></span><span class="no"></span><span class="txt">@@ -1,3 +1,4 @@</span></div><div class="row ctx"><span class="no">1</span><span class="no">1</span><span class="txt">:root {</span></div><div class="row del"><span class="no">2</span><span class="no"></span><span class="txt">  --old: 1;</span></div><div class="row add"><span class="no"></span><span class="no">2</span><span class="txt">  --new: 2;</span></div><div class="row add"><span class="no"></span><span class="no">3</span><span class="txt">  --wide: "a line long enough to make the patch scroll horizontally inside its own box";</span></div><div class="row meta"><span class="no"></span><span class="no"></span><span class="txt">No newline at end of file</span></div></div></div>')];
    const listbox = [
      sgItem('listbox (live)', `<span class="theme-label" id="sg-listbox-label">Theme</span>${sgListbox('sg-listbox')}`),
      sgItem('listbox open: active + selected + check', `<div class="sg-static"><span class="theme-label" id="sg-listbox-open-label">Theme</span>${sgListbox('sg-listbox-open', { open: true, value: 'light', active: 'dark' })}</div>`),
      sgItem('listbox open: disabled option', `<div class="sg-static"><span class="theme-label" id="sg-listbox-dis-label">Theme</span>${sgListbox('sg-listbox-dis', { open: true, value: 'system', active: 'system', disabled: true })}</div>`),
      sgItem('select trigger (plain button alias)', '<button type="button" class="select-trigger" style="width:160px">Choose</button>'),
    ];
    const kit = [
      sgItem('checkbox: unchecked / checked / disabled', '<label class="check"><input type="checkbox"> off</label><br><label class="check"><input type="checkbox" checked> on</label><br><label class="check"><input type="checkbox" disabled> disabled</label>'),
      sgItem('radio group', '<label class="check"><input type="radio" name="sg-r" checked> one</label><br><label class="check"><input type="radio" name="sg-r"> two</label><br><label class="check"><input type="radio" name="sg-r" disabled> three</label>'),
      sgItem('switch: off / on / disabled / focus', '<label class="switch"><input type="checkbox" role="switch"><span class="switch-track"><span class="switch-thumb"></span></span> off</label><br><label class="switch"><input type="checkbox" role="switch" checked><span class="switch-track"><span class="switch-thumb"></span></span> on</label><br><label class="switch"><input type="checkbox" role="switch" disabled><span class="switch-track"><span class="switch-thumb"></span></span> disabled</label><br><label class="switch sg-focus"><input type="checkbox" role="switch"><span class="switch-track"><span class="switch-thumb"></span></span> focus</label>'),
      sgItem('text input: rest / focus / disabled / placeholder', '<div style="width:220px"><input type="text" value="rest"><br><input type="text" class="sg-focus" value="focus"><br><input type="text" value="disabled" disabled><br><input type="text" placeholder="placeholder"></div>'),
      sgItem('textarea', '<div style="width:220px"><textarea rows="3">multi-line text</textarea></div>'),
    ];
    const elements = [
      sgItem('blockquote with footer and cite', '<blockquote style="width:320px"><p>Structure before decoration.</p><footer><cite>qiujm-web DESIGN.md</cite></footer></blockquote>'),
      sgItem('definition list', '<dl><dt>paper</dt><dd>the page surface</dd><dt>ink</dt><dd>the text colour</dd></dl>'),
      sgItem('figure and figcaption', '<figure style="width:240px"><pre><code>fig()</code></pre><figcaption>Figure 1: a captioned block</figcaption></figure>'),
      sgItem('kbd, mark, abbr, sup, sub', '<p>Press <kbd>Ctrl</kbd> + <kbd>S</kbd>, note the <mark>highlighted</mark> part, the <abbr title="Accessible Rich Internet Applications">ARIA</abbr> roles, x<sup>2</sup> and H<sub>2</sub>O.</p>'),
      sgItem('details: closed / open', '<div style="width:260px"><details><summary>Closed details</summary><p>hidden body</p></details><details open><summary>Open details</summary><p>visible body</p></details></div>'),
      sgItem('fieldset, legend, labels', '<fieldset style="width:240px"><legend>Options</legend><label><input type="checkbox" checked> first</label><br><label><input type="checkbox"> second</label></fieldset>'),
    ];
    const scroll = [sgItem('scroll box: both axes', '<div class="sg-scroll"><div>This box is wider and taller than its frame, so it scrolls in both directions and shows the corner.</div></div>')];
    return `<div class="crumbs">styleguide</div><h1>Styleguide</h1><p class="muted">Every component and state of the dashboard design grammar. The marker classes sg-hover, sg-active and sg-focus force pointer states for screenshots.</p>
      <div class="sg">
        ${sgSection('Tokens', tokens)}
        ${sgSection('Text and links', text)}
        ${sgSection('Buttons', buttons)}
        ${sgSection('Navigation tiles', nav)}
        ${sgSection('Tags', tags)}
        ${sgSection('Cards, panels, notices', surfaces)}
        ${sgSection('Progress', progress)}
        ${sgSection('Tables and rules', tables)}
        ${sgSection('Code', code)}
        ${sgSection('Task list', tasks)}
        ${sgSection('Linked tasks', linked)}
        ${sgSection('File tree', tree)}
        ${sgSection('Patch', patch)}
        ${sgSection('Listbox', listbox)}
        ${sgSection('Form controls', kit)}
        ${sgSection('Markdown elements', elements)}
        ${sgSection('Scrolling', scroll)}
      </div>`;
  };
  const wireStyleguide = () => {
    const root = $('sg-listbox');
    if (!root) return;
    const box = mountListbox(root, { onChange: () => {} });
    state.unmountStyleguide = box.destroy; // the mount listens on the document; render() tears it down
  };

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
      if (t && t.getAttribute && t.getAttribute('role') === 'combobox') return; // the theme listbox owns its keys
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
        if (route.page === 'change') return pageReference(route);
        if (route.page === 'invalid') return `<div class="crumbs"><a href="#/changes">changes</a></div><div class="notice">${esc(route.reason)}</div>`;
        if (route.page === 'specs') return pageSpecs(route.name);
        if (route.page === 'archive') return pageArchive(route.name);
        if (route.page === 'scratch') return pageScratch();
        if (route.page === 'file') return pageFile(route.path);
        if (route.page === 'diff') return pageDiff(route.path, out);
        if (route.page === 'styleguide') return pageStyleguide();
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
    state.unmountStyleguide?.();
    state.unmountStyleguide = null;
    state.diffOrder = out.order ?? [];
    view.classList.toggle('wide', route.page === 'diff');
    view.innerHTML = html;
    if (route.page === 'file') wireEditor();
    if (route.page === 'diff') wireDiff();
    if (route.page === 'styleguide') wireStyleguide();
    if (route.page === 'diff') doc.querySelector('.diff-left li.file.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (route.page === 'archive' && route.name) doc.getElementById(`archive-${route.name}`)?.classList.add('highlight');
    if (route.page === 'change' && route.id) doc.getElementById(anchorFor(route.type, route.id))?.classList.add('highlight');
    // Navigation moves focus to the new heading; a live refresh of the same page never does.
    const key = routeKey(route);
    if (shouldFocusHeading(state.focusedRouteKey, key)) {
      const heading = view.querySelector('h1');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: false });
      }
    }
    state.focusedRouteKey = key;
  };

  // ---- live updates
  const onChange = async (paths) => {
    const route = state.route;
    if (!shouldRefetch(route, paths)) return;
    if (route.page === 'file' && state.editor && paths.some((p) => pathWithin(route.path, p))) {
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

#!/usr/bin/env node
/**
 * my-flow dashboard: a local, zero-dependency web view over the intent layer.
 *
 *   node scripts/dashboard.mjs [start] [--port N] [--root dir] [--json]   detach a server, print its URL
 *   node scripts/dashboard.mjs start --foreground [--port N] [--root dir] run the server in this process
 *   node scripts/dashboard.mjs serve [--port N] [--root dir]              internal: the detached server process
 *   node scripts/dashboard.mjs stop [--root dir] [--json]                 verify identity, terminate, remove the state file
 *   node scripts/dashboard.mjs status [--root dir] [--json]               running / not running / stale
 *
 * The server binds a loopback address only, reads specs/ changes/ .my-flow/, pushes file changes
 * over Server-Sent Events, and accepts edits through one guarded endpoint (design D5-D7). It
 * records itself in .my-flow/state/dashboard.json so a later `stop` can find it.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync, watch, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listChanges, newestMtime, read, readState, sectionBody, splitRequirements, statusReport, validateReport } from './lib/intent.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..', 'web');
const VERSION = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')).version;
const DEFAULT_PORT = 4321;
const DEFAULT_HOST = '127.0.0.1';
const BODY_LIMIT = 5 * 1024 * 1024;
const WATCH_DIRS = ['specs', 'changes', '.my-flow'];
const STATE_REL = '.my-flow/state/dashboard.json';
const STATE_DIR_REL = '.my-flow/state';
const DEBOUNCE_MS = 150;
const PING_MS = 25_000;
const POLL_MS = 2000;
// git (design D1, D3, D5, D6): read-only invocations, capped in time and size
const GIT_TIMEOUT_MS = 5000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;
const MAX_PATCH_BYTES = 512 * 1024;
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const SCRATCH_PREFIX = '.my-flow/';
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
};

// ---------------------------------------------------------------- paths and state
/** One spelling per directory: resolved, then realpath when it exists (tmpdir is often an 8.3 short path on Windows). */
export function normalizeRoot(p) {
  const abs = resolve(p);
  try {
    return realpathSync.native(abs);
  } catch {
    return abs;
  }
}
const toSlash = (p) => p.replace(/\\/g, '/');
const relOf = (root, abs) => toSlash(abs.slice(root.length + 1));
const contained = (root, abs) => abs === root || abs.startsWith(root + sep);
const sameRoot = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const statePathOf = (root) => join(root, '.my-flow', 'state', 'dashboard.json');

/** Parsed .my-flow/state/dashboard.json, or null when missing or unreadable (fail open). */
export function readDashboardState(root) {
  try {
    return JSON.parse(readFileSync(statePathOf(root), 'utf8'));
  } catch {
    return null;
  }
}
function writeDashboardState(root, state) {
  mkdirSync(dirname(statePathOf(root)), { recursive: true });
  writeFileSync(statePathOf(root), JSON.stringify(state, null, 2) + '\n');
}
function removeDashboardState(root) {
  try {
    unlinkSync(statePathOf(root));
  } catch {
    /* already gone */
  }
}

// ---------------------------------------------------------------- allow-lists (D7)
const READ_RE = /^(specs\/.+|changes\/.+|\.my-flow\/(ask|verify|interviews)\/.+)\.md$/i;
/**
 * Resolves a client-supplied relative path inside root. Returns { abs, rel } or { error, status }.
 * Order: string with no NUL and not absolute -> resolves inside root.
 */
function resolveClientPath(root, path) {
  if (typeof path !== 'string' || !path || path.includes('\0') || isAbsolute(path)) return { status: 400, error: 'bad-path', message: 'path must be a non-empty relative path' };
  const abs = resolve(root, path);
  if (!contained(root, abs)) return { status: 400, error: 'outside-root', message: 'path resolves outside the project root' };
  return { abs, rel: relOf(root, abs) };
}
const readable = (rel) => READ_RE.test(rel);
function writable(root, rel) {
  if (!/\.md$/i.test(rel)) return false;
  if (/^specs\/.+/.test(rel)) return true;
  const m = /^changes\/([^/]+)\/.+/.exec(rel);
  return !!m && listChanges(root).includes(m[1]);
}
const eolOf = (text) => (text.includes('\r\n') ? 'crlf' : 'lf');
/** The execute lock (design D7): read per request and fail-open, so it lifts the moment `spec stage` rewrites the state. */
function lockOf(root) {
  const s = readState(root);
  if (!s || s.stage !== 'execute') return null;
  const change = typeof s.change === 'string' ? s.change : null;
  return { change, stage: 'execute', message: `the dashboard is read-only while "${change ?? 'the current change'}" is at stage execute; an agent is writing` };
}

// ---------------------------------------------------------------- git (read-only)
/** One git call: { status, stdout, stderr, error }. Never throws; stderr is only used for messages. */
function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error ?? null };
}
class GitError extends Error {
  constructor(args, r) {
    super(`git ${args[0]} failed: ${(r.error?.code ?? r.stderr.split('\n')[0] ?? '').trim() || `exit ${r.status}`}`);
    this.code = 'git-failed';
  }
}
/** Once at start (design D2): is root inside a work tree, and does HEAD exist? */
export function detectGit(root) {
  const inside = git(root, ['rev-parse', '--is-inside-work-tree']);
  const ok = inside.status === 0 && inside.stdout.trim() === 'true';
  if (!ok) return { ok: false, head: null };
  const head = git(root, ['rev-parse', '--verify', 'HEAD']);
  return { ok: true, head: head.status === 0 ? head.stdout.trim() : null };
}
const gitBase = (root) => (git(root, ['rev-parse', '--verify', 'HEAD']).status === 0 ? 'HEAD' : EMPTY_TREE);
const splitZ = (s) => s.split('\0').filter((t) => t !== '');
const inScratch = (p) => p === SCRATCH_PREFIX.slice(0, -1) || p.startsWith(SCRATCH_PREFIX);
function sniffBinary(abs) {
  try {
    const fd = readFileSync(abs, { flag: 'r' });
    return fd.subarray(0, 8192).includes(0);
  } catch {
    return false;
  }
}
/** The entry's own modification time; null when it cannot be stated (deleted), never following a link. */
function mtimeOf(root, path) {
  try {
    return lstatSync(join(root, path)).mtimeMs;
  } catch {
    return null;
  }
}
/**
 * Changed files of the working tree against `base` (design D3, D10): tracked changes from
 * `git diff --name-status` and `--numstat`, untracked files from `ls-files --others`. Paths under
 * `.my-flow/` are dropped unconditionally so the dashboard's own scratch never reaches the page.
 */
export function diffList(root, base) {
  const run = (args) => {
    const r = git(root, args);
    if (r.status !== 0 || r.error) throw new GitError(args, r);
    return r.stdout;
  };
  const files = [];
  const byPath = new Map();
  const names = splitZ(run(['diff', base, '--name-status', '-z', '-M', '--']));
  for (let i = 0; i < names.length; ) {
    const code = names[i++];
    const status = code[0];
    const oldPath = status === 'R' || status === 'C' ? names[i++] : null;
    const path = names[i++];
    if (path === undefined) break;
    const entry = { path, status, oldPath, added: null, deleted: null, binary: false, untracked: false, mtimeMs: mtimeOf(root, path) };
    files.push(entry);
    byPath.set(path, entry);
  }
  const nums = splitZ(run(['diff', base, '--numstat', '-z', '-M', '--']));
  for (let i = 0; i < nums.length; ) {
    const [a, d, p] = nums[i++].split('\t');
    let path = p;
    if (path === '') {
      i++; // old path of a rename
      path = nums[i++];
    }
    const entry = byPath.get(path);
    if (!entry) continue;
    if (a === '-' || d === '-') entry.binary = true;
    else {
      entry.added = Number(a);
      entry.deleted = Number(d);
    }
  }
  for (const path of splitZ(run(['ls-files', '--others', '--exclude-standard', '-z']))) {
    if (byPath.has(path)) continue;
    const abs = join(root, path);
    let binary = false;
    let mtimeMs = null;
    try {
      const st = lstatSync(abs);
      mtimeMs = st.mtimeMs;
      if (st.isFile()) binary = sniffBinary(abs);
    } catch {
      /* listed but unreadable: still listed, with no time */
    }
    files.push({ path, status: '?', oldPath: null, added: null, deleted: null, binary, untracked: true, mtimeMs });
  }
  return files.filter((f) => !inScratch(f.path) && !(f.oldPath && inScratch(f.oldPath)));
}
/** The unified patch for one listed entry (design D5, D6). */
export function diffPatch(root, base, entry) {
  const out = { path: entry.path, status: entry.status, oldPath: entry.oldPath, binary: entry.binary, truncated: false, skipped: null, patch: null };
  if (entry.binary) return out;
  if (!entry.untracked) {
    const args = ['diff', base, '-M', '--', ...(entry.oldPath ? [entry.oldPath] : []), entry.path];
    const r = git(root, args);
    if (r.error?.code === 'ENOBUFS') return { ...out, truncated: true };
    if (r.status !== 0 || r.error) throw new GitError(args, r);
    if (Buffer.byteLength(r.stdout) > MAX_PATCH_BYTES) return { ...out, truncated: true };
    return { ...out, patch: r.stdout };
  }
  const p = resolveClientPath(root, entry.path);
  if (p.error) return { ...out, skipped: 'outside-root' };
  let st;
  try {
    st = lstatSync(p.abs);
  } catch {
    return { ...out, skipped: 'missing' };
  }
  if (!st.isFile()) return { ...out, skipped: 'not-a-regular-file' }; // symlinks are never followed
  if (st.size > MAX_PATCH_BYTES) return { ...out, truncated: true };
  const buf = readFileSync(p.abs);
  if (buf.subarray(0, 8192).includes(0)) return { ...out, binary: true };
  const text = buf.toString('utf8');
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  const lines = body === '' && text === '' ? [] : body.split('\n');
  const patch =
    `diff --git a/${entry.path} b/${entry.path}\nnew file mode 100644\n--- /dev/null\n+++ b/${entry.path}\n@@ -0,0 +1,${lines.length} @@\n` +
    lines.map((l) => `+${l}`).join('\n') +
    (lines.length ? '\n' : '') +
    (text.endsWith('\n') || text === '' ? '' : '\\ No newline at end of file\n');
  return { ...out, patch };
}

// ---------------------------------------------------------------- read-only API
function changeDetail(root, name) {
  if (!listChanges(root).includes(name)) return null;
  const dir = join(root, 'changes', name);
  const files = [];
  const entry = (abs, kind, extra = {}) => {
    const exists = existsSync(abs);
    const st = exists ? statSync(abs) : null;
    files.push({ path: relOf(root, abs), kind, exists, mtimeMs: st?.mtimeMs ?? null, size: st?.size ?? null, ...extra });
  };
  for (const f of ['proposal', 'design', 'tasks']) entry(join(dir, `${f}.md`), f);
  const deltaRoot = join(dir, 'specs');
  if (existsSync(deltaRoot)) {
    for (const cap of readdirSync(deltaRoot, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      entry(join(deltaRoot, cap.name, 'spec.md'), 'delta', { capability: cap.name });
    }
  }
  return { name, files, row: statusReport(root, { name }).json.changes[0] };
}
const VIA_RE = /<!-- via: (.+?) -->/;
function specsIndex(root) {
  const SPECS = join(root, 'specs');
  const capabilities = [];
  if (!existsSync(SPECS)) return { capabilities };
  for (const d of readdirSync(SPECS, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const abs = join(SPECS, d.name, 'spec.md');
    const text = read(abs);
    if (text === null) continue;
    const requirements = [...splitRequirements(text).blocks].map(([name, block]) => ({ name, via: VIA_RE.exec(block)?.[1] ?? null }));
    capabilities.push({ name: d.name, path: relOf(root, abs), mtimeMs: statSync(abs).mtimeMs, requirements });
  }
  return { capabilities };
}
function archiveIndex(root) {
  const archiveDir = join(root, 'changes', 'archive');
  const entries = [];
  if (!existsSync(archiveDir)) return { entries };
  const dirs = readdirSync(archiveDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse();
  for (const dir of dirs) {
    const m = /^(\d{4}-\d{2}-\d{2})-(.+?)(-abandoned)?$/.exec(dir);
    const abs = join(archiveDir, dir);
    const kind = m?.[3] ? 'abandoned' : 'archived';
    let reason = null;
    if (kind === 'abandoned') {
      const proposal = read(join(abs, 'proposal.md')) ?? '';
      reason = /^\*\*Reason\*\*:?\s*(.*)$/m.exec(sectionBody(proposal, 'Abandoned'))?.[1]?.trim() ?? null;
    }
    const specDir = join(abs, 'specs');
    const capabilities = existsSync(specDir) ? readdirSync(specDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
    entries.push({ dir: relOf(root, abs), date: m?.[1] ?? null, change: m?.[2] ?? dir, kind, reason, mtimeMs: statSync(abs).mtimeMs, capabilities });
  }
  return { entries };
}
function scratchIndex(root) {
  const out = {};
  for (const sub of ['ask', 'verify', 'interviews']) {
    const dir = join(root, '.my-flow', sub);
    out[sub] = existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true })
          .filter((d) => d.isFile() && /\.md$/i.test(d.name))
          .map((d) => {
            const st = statSync(join(dir, d.name));
            return { path: `.my-flow/${sub}/${d.name}`, name: d.name, mtimeMs: st.mtimeMs, size: st.size };
          })
          .sort((a, b) => b.mtimeMs - a.mtimeMs)
      : [];
  }
  return out;
}

// ---------------------------------------------------------------- server
/**
 * Starts the dashboard. Resolves once bound and the state file is written.
 * Returns { url, port, host, root, server, close(), watchers } ; `watchers` is exposed for tests.
 */
export async function startServer({ root: rootArg = process.cwd(), port = DEFAULT_PORT, host = DEFAULT_HOST } = {}) {
  const root = normalizeRoot(rootArg);
  const started = new Date().toISOString();
  const gitInfo = detectGit(root); // once (design D2); a later failure is a per-request 500
  const clients = new Set();
  const watchers = [];
  const timers = new Set();
  let pending = new Set();
  let flushTimer = null;

  // ---- push (D6)
  const broadcast = (event, data) => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
      try {
        res.write(frame);
      } catch {
        clients.delete(res);
      }
    }
  };
  const queue = (rel) => {
    // The server's own state file is never an update; a recursive watcher also reports its
    // parent directory for that write, and a bare directory event carries nothing the client needs.
    if (rel === STATE_REL || rel === STATE_DIR_REL) return;
    pending.add(rel);
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      const paths = [...pending].sort();
      pending = new Set();
      broadcast('change', { at: new Date().toISOString(), paths });
    }, DEBOUNCE_MS);
  };
  const pollFallback = (dir) => {
    const abs = join(root, dir);
    let last = null;
    const tick = () => {
      let now;
      try {
        now = existsSync(abs) ? newestMtime(abs) : null;
      } catch {
        return; // a file vanished mid-walk; compare again next tick
      }
      if (last !== null && now !== last) queue(dir);
      last = now;
    };
    tick();
    const t = setInterval(tick, POLL_MS);
    timers.add(t);
  };
  const watchDir = (dir) => {
    const abs = join(root, dir);
    if (!existsSync(abs)) return;
    let w;
    try {
      w = watch(abs, { recursive: true }, (_event, filename) => {
        queue(filename ? `${dir}/${toSlash(String(filename))}` : dir);
      });
    } catch (e) {
      console.error(`[dashboard] fs.watch failed for ${dir}/ (${e.code ?? e.message}); polling every ${POLL_MS} ms`);
      pollFallback(dir);
      return;
    }
    w.on('error', (e) => {
      console.error(`[dashboard] watcher error for ${dir}/ (${e.code ?? e.message}); polling every ${POLL_MS} ms`);
      try {
        w.close();
      } catch {
        /* already closed */
      }
      pollFallback(dir);
    });
    watchers.push(w);
  };

  // ---- http
  let boundPort = port;
  const origins = () => [`http://127.0.0.1:${boundPort}`, `http://localhost:${boundPort}`];
  const hosts = () => [`127.0.0.1:${boundPort}`, `localhost:${boundPort}`];
  const send = (res, status, obj, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
    res.end(JSON.stringify(obj));
  };
  const fail = (res, status, error, message, headers) => send(res, status, { ok: false, error, message }, headers);
  /** Collects the body up to BODY_LIMIT; past it, answers 413 at once, drains the rest and resolves null. */
  const readBody = (req, res) =>
    new Promise((resolveBody) => {
      const chunks = [];
      let size = 0;
      let overflow = false;
      req.on('data', (c) => {
        if (overflow) return;
        size += c.length;
        if (size > BODY_LIMIT) {
          overflow = true;
          chunks.length = 0;
          fail(res, 413, 'body-too-large', `body exceeds ${BODY_LIMIT} bytes`, { connection: 'close' });
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => resolveBody(overflow ? null : Buffer.concat(chunks).toString('utf8')));
      req.on('error', () => resolveBody(null));
    });

  const handleFileGet = (res, url) => {
    const r = resolveClientPath(root, url.searchParams.get('path') ?? '');
    if (r.error) return fail(res, r.status, r.error, r.message);
    if (!readable(r.rel)) return fail(res, 403, 'not-readable', `${r.rel} is outside the readable directories`);
    if (!existsSync(r.abs) || !statSync(r.abs).isFile()) return fail(res, 404, 'no-such-file', `${r.rel} does not exist`);
    const raw = readFileSync(r.abs, 'utf8');
    const canWrite = writable(root, r.rel);
    const lock = canWrite ? lockOf(root) : null; // a read-only file never claims a lock
    return send(res, 200, {
      path: r.rel,
      content: raw.replace(/\r\n/g, '\n'),
      mtimeMs: statSync(r.abs).mtimeMs,
      eol: eolOf(raw),
      writable: canWrite && !lock,
      lockReason: lock ? lock.message : null,
    });
  };
  const handleFilePost = async (req, res) => {
    if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return fail(res, 415, 'bad-content-type', 'POST /api/file requires content-type: application/json');
    const body = await readBody(req, res);
    if (body === null) return undefined;
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return fail(res, 400, 'bad-json', 'body is not valid JSON');
    }
    const r = resolveClientPath(root, data?.path);
    if (r.error) return fail(res, r.status, r.error, r.message);
    if (!/\.md$/i.test(r.abs)) return fail(res, 403, 'not-writable', 'only markdown files can be saved');
    if (!writable(root, r.rel)) return fail(res, 403, 'not-writable', `${r.rel} is not under specs/ or an active change`);
    const lock = lockOf(root); // after the request is judged, before any filesystem state is disclosed
    if (lock) return send(res, 423, { ok: false, error: 'locked', change: lock.change, stage: lock.stage, message: lock.message });
    if (!existsSync(r.abs) || !statSync(r.abs).isFile()) return fail(res, 404, 'no-such-file', `${r.rel} does not exist; the dashboard edits, it does not create`);
    if (typeof data.content !== 'string') return fail(res, 400, 'bad-content', 'content must be a string');
    const onDisk = readFileSync(r.abs, 'utf8');
    const current = statSync(r.abs).mtimeMs;
    if (data.force !== true && current !== data.mtimeMs) {
      return send(res, 409, { ok: false, error: 'mtime', message: `${r.rel} changed on disk since it was loaded`, mtimeMs: current, content: onDisk.replace(/\r\n/g, '\n') });
    }
    const eol = eolOf(onDisk);
    let text = data.content.replace(/\r\n?/g, '\n');
    if (eol === 'crlf') text = text.replace(/\n/g, '\r\n');
    writeFileSync(r.abs, text, 'utf8');
    return send(res, 200, { ok: true, path: r.rel, mtimeMs: statSync(r.abs).mtimeMs, eol });
  };
  const handleEvents = (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`event: hello\ndata: ${JSON.stringify({ root, port: boundPort, started, git: gitInfo.ok })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
  };
  const handleStatic = (res, url) => {
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return fail(res, 400, 'bad-path', 'malformed URL');
    }
    if (pathname === '/' || !extname(pathname)) pathname = '/index.html';
    const abs = resolve(WEB, `.${pathname}`);
    const type = CONTENT_TYPES[extname(abs).toLowerCase()];
    if (!contained(WEB, abs) || !type || !existsSync(abs) || !statSync(abs).isFile()) return fail(res, 404, 'not-found', 'no such asset');
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
    return res.end(readFileSync(abs));
  };

  const handle = async (req, res) => {
    // Same-origin guard (D5a) before any handler.
    if (!hosts().includes(req.headers.host ?? '')) return fail(res, 403, 'bad-host', 'Host must be the loopback address and bound port');
    if (req.headers.origin !== undefined && !origins().includes(req.headers.origin)) return fail(res, 403, 'bad-origin', 'cross-origin requests are not accepted');
    const url = new URL(req.url, `http://${hosts()[0]}`);
    const p = url.pathname;
    if (p.startsWith('/api/')) {
      if (req.method === 'GET' && p === '/api/health') return send(res, 200, { ok: true, pid: process.pid, host, port: boundPort, root, started, version: VERSION, git: gitInfo.ok });
      if (req.method === 'GET' && p === '/api/status') return send(res, 200, statusReport(root).json);
      if (req.method === 'GET' && p === '/api/validate') return send(res, 200, validateReport(root).json);
      if (req.method === 'GET' && p.startsWith('/api/changes/')) {
        const name = decodeURIComponent(p.slice('/api/changes/'.length));
        const detail = changeDetail(root, name);
        return detail ? send(res, 200, detail) : fail(res, 404, 'no-such-change', `changes/${name} is not an active change`);
      }
      if (req.method === 'GET' && p === '/api/specs') return send(res, 200, specsIndex(root));
      if (req.method === 'GET' && p === '/api/archive') return send(res, 200, archiveIndex(root));
      if (req.method === 'GET' && p === '/api/scratch') return send(res, 200, scratchIndex(root));
      if (req.method === 'GET' && p === '/api/file') return handleFileGet(res, url);
      if (req.method === 'POST' && p === '/api/file') return handleFilePost(req, res);
      if (req.method === 'GET' && p === '/api/events') return handleEvents(req, res);
      if (req.method === 'GET' && (p === '/api/diff' || p === '/api/diff/file')) {
        if (!gitInfo.ok) return fail(res, 404, 'no-git', 'this project root is not inside a git work tree');
        try {
          const base = gitBase(root);
          const files = diffList(root, base);
          if (p === '/api/diff') {
            const head = base === 'HEAD' ? git(root, ['rev-parse', 'HEAD']).stdout.trim() : null;
            return send(res, 200, { git: true, base: base === 'HEAD' ? 'HEAD' : 'empty-tree', head, files });
          }
          const path = url.searchParams.get('path') ?? '';
          const entry = files.find((f) => f.path === path);
          if (!entry) return fail(res, 400, 'not-in-diff', `${path || '(empty)'} is not among the changed files`);
          return send(res, 200, diffPatch(root, base, entry));
        } catch (e) {
          if (e?.code === 'git-failed') return fail(res, 500, 'git-failed', e.message);
          throw e;
        }
      }
      return fail(res, 404, 'not-found', `no route ${req.method} ${p}`);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'method-not-allowed', 'static assets are read-only');
    return handleStatic(res, url);
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error(`[dashboard] ${req.method} ${req.url}: ${e?.stack ?? e}`);
      if (!res.headersSent) fail(res, 500, 'internal', String(e?.message ?? e));
      else res.end();
    });
  });
  server.keepAliveTimeout = 5000;

  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolveListen();
    });
  });
  boundPort = server.address().port;
  const url = `http://${host}:${boundPort}/`;
  writeDashboardState(root, { pid: process.pid, host, port: boundPort, url, root, started });
  for (const dir of WATCH_DIRS) watchDir(dir);
  const ping = setInterval(() => {
    for (const res of clients) {
      try {
        res.write(': ping\n\n');
      } catch {
        clients.delete(res);
      }
    }
  }, PING_MS);
  timers.add(ping);

  let closed = null;
  const close = () => {
    if (closed) return closed;
    closed = new Promise((resolveClose) => {
      for (const t of timers) clearInterval(t);
      timers.clear();
      if (flushTimer) clearTimeout(flushTimer);
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          /* already closed */
        }
      }
      for (const res of clients) {
        try {
          res.end();
        } catch {
          /* gone */
        }
      }
      clients.clear();
      removeDashboardState(root);
      server.close(() => resolveClose());
      server.closeAllConnections();
    });
    return closed;
  };
  return { url, port: boundPort, host, root, server, close, watchers };
}

// ---------------------------------------------------------------- CLI
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // exists, owned by someone else
  }
};
async function probe(state) {
  try {
    const r = await fetch(`http://127.0.0.1:${state.port}/api/health`, { signal: AbortSignal.timeout(1000), headers: { host: `127.0.0.1:${state.port}` } });
    const j = await r.json();
    return { answered: true, matches: j.pid === state.pid && typeof j.root === 'string' && sameRoot(j.root, state.root), health: j };
  } catch {
    return { answered: false };
  }
}
/**
 * Identity check shared by stop and status (design D3): returns one of
 *   { kind: 'none' } | { kind: 'stale', reason } (file removed, nothing signalled) |
 *   { kind: 'silent', state } (alive but not answering: file kept) | { kind: 'running', state, health }
 */
async function inspect(root) {
  const state = readDashboardState(root);
  if (!state) return { kind: 'none' };
  const pid = state.pid;
  if (!Number.isInteger(pid) || pid <= 0) {
    removeDashboardState(root);
    return { kind: 'stale', reason: 'state file holds no valid pid' };
  }
  if (!alive(pid)) {
    removeDashboardState(root);
    return { kind: 'stale', reason: `process ${pid} no longer exists` };
  }
  const p = await probe(state);
  if (!p.answered) return { kind: 'silent', state };
  if (!p.matches) {
    removeDashboardState(root);
    return { kind: 'stale', reason: `port ${state.port} answers for a different dashboard (pid ${p.health?.pid}, root ${p.health?.root})` };
  }
  return { kind: 'running', state, health: p.health };
}

function parseArgs(argv) {
  const opts = { root: process.cwd(), port: DEFAULT_PORT, json: false, foreground: false, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') opts.root = argv[++i];
    else if (a === '--port') opts.port = Number(argv[++i]);
    else if (a === '--json') opts.json = true;
    else if (a === '--foreground') opts.foreground = true;
    else if (!a.startsWith('--')) opts.positional.push(a);
  }
  if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) throw new Error(`invalid --port ${opts.port}`);
  return opts;
}

async function cliServe(root, port) {
  const h = await startServer({ root, port });
  const stop = () => h.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return h;
}
async function cliStart({ root, port, json, foreground }) {
  const out = (obj, text) => console.log(json ? JSON.stringify(obj) : text);
  const seen = await inspect(root);
  if (seen.kind === 'running') {
    console.error(`dashboard already running at ${seen.state.url} (pid ${seen.state.pid}); stop it first`);
    return 1;
  }
  if (seen.kind === 'silent') {
    console.error(`a dashboard is recorded on port ${seen.state.port} (pid ${seen.state.pid}) but does not answer; run "dashboard stop" first`);
    return 1;
  }
  if (foreground) {
    let h;
    try {
      h = await cliServe(root, port);
    } catch (e) {
      console.error(e.code === 'EADDRINUSE' ? `port ${port} is already in use` : `dashboard failed to start: ${e.message}`);
      return 1;
    }
    out({ ok: true, url: h.url, pid: process.pid, port: h.port, root: h.root }, `dashboard running at ${h.url} (Ctrl-C to stop)`);
    return null; // keep the process alive
  }
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve', '--root', root, '--port', String(port)], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  let exited = null;
  child.on('exit', (code) => {
    exited = code ?? 1;
  });
  child.unref();
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const s = readDashboardState(root);
    if (s && s.pid === child.pid) {
      out({ ok: true, url: s.url, pid: s.pid, port: s.port, root: s.root }, `dashboard started at ${s.url} (pid ${s.pid})`);
      return 0;
    }
    if (exited !== null) break;
    await sleep(100);
  }
  console.error(exited !== null ? `dashboard failed to start on port ${port} (exit code ${exited}); is the port already in use?` : `dashboard did not start on port ${port} within 5 s`);
  return 1;
}
async function cliStop({ root, json }) {
  const out = (obj, text) => console.log(json ? JSON.stringify(obj) : text);
  const seen = await inspect(root);
  if (seen.kind === 'none') return out({ ok: true, running: false }, 'dashboard is not running'), 0;
  if (seen.kind === 'stale') return out({ ok: true, running: false, stale: true, reason: seen.reason }, `removed stale dashboard state (${seen.reason})`), 0;
  if (seen.kind === 'silent') {
    console.error(`dashboard pid ${seen.state.pid} on port ${seen.state.port} did not answer; state file kept, try again`);
    return 1;
  }
  const { pid } = seen.state;
  process.kill(pid, 'SIGTERM');
  const deadline = Date.now() + 3000;
  while (alive(pid) && Date.now() < deadline) await sleep(100);
  removeDashboardState(root);
  if (alive(pid)) {
    console.error(`sent SIGTERM to pid ${pid} but it is still alive after 3 s`);
    return 1;
  }
  return out({ ok: true, running: false, stopped: pid }, `dashboard stopped (pid ${pid})`), 0;
}
async function cliStatus({ root, json }) {
  const out = (obj, text) => console.log(json ? JSON.stringify(obj) : text);
  const seen = await inspect(root);
  if (seen.kind === 'none') return out({ ok: true, running: false }, 'dashboard is not running'), 0;
  if (seen.kind === 'stale') return out({ ok: true, running: false, stale: true, reason: seen.reason }, `removed stale dashboard state (${seen.reason})`), 0;
  if (seen.kind === 'silent') return out({ ok: false, running: null, pid: seen.state.pid, port: seen.state.port, url: seen.state.url }, `dashboard pid ${seen.state.pid} on port ${seen.state.port} did not answer (state file kept)`), 1;
  const s = seen.state;
  return out({ ok: true, running: true, url: s.url, pid: s.pid, port: s.port, root: s.root, started: s.started }, `dashboard running at ${s.url} (pid ${s.pid}, since ${s.started})`), 0;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    return 1;
  }
  const cmd = opts.positional[0] ?? 'start';
  const root = normalizeRoot(opts.root);
  if (cmd === 'serve') {
    try {
      await cliServe(root, opts.port);
    } catch (e) {
      console.error(e.code === 'EADDRINUSE' ? `port ${opts.port} is already in use` : `dashboard failed to start: ${e.message}`);
      return 1;
    }
    return null;
  }
  if (cmd === 'start') return cliStart({ ...opts, root });
  if (cmd === 'stop') return cliStop({ ...opts, root });
  if (cmd === 'status') return cliStatus({ ...opts, root });
  console.error('usage: dashboard.mjs [start [--foreground]] | stop | status  [--port N] [--root dir] [--json]');
  return 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().then((code) => {
    if (code !== null) process.exit(code);
  });
}

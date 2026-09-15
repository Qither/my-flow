/**
 * my-flow coordinated intent I/O (contract C-09).
 *
 * One exclusive repository lock and one generic journal/recover implementation for every
 * cooperating intent writer. There is no per-change lock and no separate archive lock.
 *
 * Contract:
 *   - every function takes `root` explicitly; nothing reads process.argv, nothing calls
 *     process.exit, nothing keeps state between calls beyond the files it writes;
 *   - acquisition is bounded (2 s by default) and returns a retryable `busy` error rather
 *     than a partial result; callers map it to CLI exit 2, API 503 and write 423;
 *   - a nested library call receives the caller's token and never acquires a second lock;
 *   - a pending journal blocks ordinary reads and writes until `recoverTransaction` runs;
 *   - a stale lock is never removed by timeout alone: explicit recovery checks the recorded
 *     owner's liveness first, and never overwrites a live owner or an external edit.
 */
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

export const TX_DIR_REL = 'changes/.transactions';
export const LOCK_REL = `${TX_DIR_REL}/intent.lock`;
export const DEFAULT_TIMEOUT_MS = 2000;
const SCHEMA_VERSION = 1;
const POLL_MS = 25;

/** Every failure this module raises carries a stable `code`; `busy` is the only retryable one. */
export class IntentIoError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'IntentIoError';
    this.code = code;
    this.retryable = code === 'busy';
    Object.assign(this, details);
  }
}

export const txDir = (root) => join(root, 'changes', '.transactions');
export const lockPath = (root) => join(txDir(root), 'intent.lock');
const journalPath = (root, id) => join(txDir(root), id, 'journal.json');
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Synchronous sleep with no dependency and no busy-wait. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Resolves a repository-relative path and refuses anything outside `root`, absolute, or
 * reached through a symlinked parent. Every journal path passes through here.
 */
export function confine(root, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0') || isAbsolute(rel)) {
    throw new IntentIoError('bad-path', `path must be a non-empty relative path (got ${JSON.stringify(rel)})`);
  }
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new IntentIoError('outside-root', `${rel} resolves outside the project root`);
  }
  return abs;
}
const toSlash = (p) => p.replace(/\\/g, '/');

// ---------------------------------------------------------------- atomic single-file write
/**
 * Temporary file in the destination directory, flushed, then renamed over the target. Used for
 * every single-file intent write while the caller holds the lock.
 */
export function writeFileAtomic(abs, data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}-${Date.now().toString(36)}`;
  const fd = openSync(tmp, 'wx');
  try {
    writeSync(fd, buf);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, abs);
  return abs;
}

// ---------------------------------------------------------------- the one repository lock
/** Parsed lock owner record, or null when the lock is free or its record is unreadable. */
export function readLockOwner(root) {
  try {
    return JSON.parse(readFileSync(lockPath(root), 'utf8'));
  } catch {
    return existsSync(lockPath(root)) ? { corrupt: true } : null;
  }
}

/**
 * `alive` | `dead` | `unknown`. A lock recorded by another host is never assumed dead, and
 * `unknown` is treated as live everywhere in this module.
 */
export function ownerLiveness(owner) {
  if (!owner || owner.corrupt || typeof owner.pid !== 'number') return 'unknown';
  if (owner.host !== hostname()) return 'unknown';
  if (owner.pid === process.pid) return 'alive';
  try {
    process.kill(owner.pid, 0);
    return 'alive';
  } catch (e) {
    return e.code === 'ESRCH' ? 'dead' : 'unknown';
  }
}

/**
 * Acquires the single repository lock, retrying until `timeoutMs` elapses. Never breaks an
 * existing lock, however old: only `recoverTransaction` may reclaim one, and only explicitly.
 */
export function acquireLock(root, { purpose = 'intent', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const p = lockPath(root);
  mkdirSync(dirname(p), { recursive: true });
  const nonce = `${process.pid.toString(36)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const record = { schemaVersion: SCHEMA_VERSION, nonce, pid: process.pid, host: hostname(), purpose, acquired: new Date().toISOString() };
  const deadline = Date.now() + Math.max(0, timeoutMs);
  for (;;) {
    try {
      writeFileSync(p, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
      return { root, nonce, path: p, purpose, depth: 1 };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (Date.now() >= deadline) {
        const owner = readLockOwner(root);
        throw new IntentIoError('busy', `the intent lock is held by another operation (${owner?.purpose ?? 'unknown purpose'}, pid ${owner?.pid ?? '?'}); retry shortly`, { owner });
      }
      sleepSync(POLL_MS);
    }
  }
}

/** Releases a lock this process holds. A token whose nonce no longer matches releases nothing. */
export function releaseLock(root, token) {
  if (!token || token.root !== root) return false;
  const owner = readLockOwner(root);
  if (!owner || owner.nonce !== token.nonce) return false;
  try {
    unlinkSync(lockPath(root));
    return true;
  } catch {
    return false;
  }
}

/** True when `token` still names the live holder of this root's lock. */
export function holdsLock(root, token) {
  return !!token && token.root === root && readLockOwner(root)?.nonce === token.nonce;
}

/**
 * Runs `fn(token)` under the repository lock. A caller that already holds the lock passes its
 * token through `opts.token`; the nested call reuses it and never acquires a second lock.
 */
export function withIntentLock(root, fn, { purpose = 'intent', timeoutMs = DEFAULT_TIMEOUT_MS, token = null } = {}) {
  if (token) {
    if (!holdsLock(root, token)) throw new IntentIoError('lock-lost', 'the caller-supplied intent lock token is no longer the live holder');
    return fn({ ...token, depth: token.depth + 1 });
  }
  const own = acquireLock(root, { purpose, timeoutMs });
  // A CLI body may end its process from inside the callback (`usage:` refusals do). `finally`
  // does not run after process.exit, so the exit handler is what actually guarantees release.
  const onExit = () => {
    try {
      releaseLock(root, own);
    } catch {
      /* the lock is best-effort on the way out */
    }
  };
  process.on('exit', onExit);
  try {
    return fn(own);
  } finally {
    process.off('exit', onExit);
    releaseLock(root, own);
  }
}

/**
 * The read side of the same protocol: a complete multi-file intent read holds the lock until
 * its whole result is materialized in memory, so a reader paused between files blocks a
 * publication instead of combining a before state with an after state. Callers release before
 * HTTP delivery or SSE notification simply by returning.
 */
export function withIntentSnapshot(root, fn, { purpose = 'read', timeoutMs = DEFAULT_TIMEOUT_MS, token = null, allowPending = false } = {}) {
  return withIntentLock(
    root,
    (t) => {
      if (!allowPending) assertNoPendingTransaction(root);
      return fn(t);
    },
    { purpose, timeoutMs, token }
  );
}

// ---------------------------------------------------------------- pending journals
/** Every transaction directory whose journal exists and is not yet committed. */
export function pendingTransactions(root) {
  const dir = txDir(root);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const p = journalPath(root, d.name);
    if (!existsSync(p)) continue;
    let j;
    try {
      j = JSON.parse(readFileSync(p, 'utf8'));
    } catch {
      out.push({ id: d.name, phase: 'corrupt', purpose: null, created: null });
      continue;
    }
    if (j.phase !== 'committed') out.push({ id: d.name, phase: j.phase, purpose: j.purpose ?? null, created: j.created ?? null });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Throws `recovery-pending` when any journal is unfinished; the message names the recovery command. */
export function assertNoPendingTransaction(root) {
  const pending = pendingTransactions(root);
  if (!pending.length) return;
  const ids = pending.map((p) => p.id).join(', ');
  throw new IntentIoError('recovery-pending', `an intent transaction is unfinished (${ids}); run "spec recover ${pending[0].id}" before reading or writing intent files`, { pending });
}

// ---------------------------------------------------------------- transactions
const fileImage = (root, rel) => {
  const abs = confine(root, rel);
  if (!existsSync(abs)) return { exists: false, hash: null, bytes: null };
  const buf = readFileSync(abs);
  return { exists: true, hash: sha256(buf), bytes: buf.toString('base64') };
};
const imageBuf = (img) => (img.exists ? Buffer.from(img.bytes ?? '', 'base64') : null);
const sameImage = (root, rel, img) => {
  const cur = fileImage(root, rel);
  return cur.exists === img.exists && cur.hash === img.hash;
};

/**
 * Normalizes caller steps into journal steps with before images read from disk now.
 *   { kind: 'file', path, content }   content string/Buffer, or null to delete
 *   { kind: 'move', from, to }        same-volume directory or file relocation
 */
function buildSteps(root, steps) {
  return steps.map((s) => {
    if (s.kind === 'move') {
      const from = toSlash(s.from);
      const to = toSlash(s.to);
      confine(root, from);
      confine(root, to);
      return { kind: 'move', from, to };
    }
    const path = toSlash(s.path);
    const before = fileImage(root, path);
    const after =
      s.content === null || s.content === undefined
        ? { exists: false, hash: null, bytes: null }
        : (() => {
            const buf = Buffer.isBuffer(s.content) ? s.content : Buffer.from(String(s.content), 'utf8');
            return { exists: true, hash: sha256(buf), bytes: buf.toString('base64') };
          })();
    return { kind: 'file', path, before, after };
  });
}

/** Writes the journal durably: content flushed to disk, then published by rename. */
function publishJournal(root, id, journal) {
  const dir = join(txDir(root), id);
  mkdirSync(dir, { recursive: true });
  writeFileAtomic(join(dir, 'journal.json'), JSON.stringify(journal, null, 2) + '\n');
}

const runFailpoint = (hooks, name, ctx) => {
  if (hooks?.failpoint) hooks.failpoint(name, ctx);
  if (process.env.MY_FLOW_IO_FAILPOINT === name) throw new IntentIoError('failpoint', `injected failure at ${name}`);
};

/**
 * Prepares, applies and commits one multi-file transaction under the caller's lock.
 * The caller must already hold the lock (pass `token`), because preflight decisions were made
 * under it. Returns `{ id, dir, steps }`.
 */
export function runTransaction(root, { purpose, steps, id: wantedId, hooks } = {}, token) {
  if (!holdsLock(root, token)) throw new IntentIoError('lock-lost', 'runTransaction requires the live intent lock token');
  const id = wantedId ?? `tx-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
  const journal = {
    schemaVersion: SCHEMA_VERSION,
    id,
    purpose: purpose ?? 'intent',
    created: new Date().toISOString(),
    phase: 'prepared',
    steps: buildSteps(root, steps ?? []),
  };
  publishJournal(root, id, journal);
  runFailpoint(hooks, 'after-journal', { id });
  journal.phase = 'applying';
  publishJournal(root, id, journal);
  applySteps(root, journal, hooks);
  runFailpoint(hooks, 'before-commit', { id });
  journal.phase = 'committed';
  journal.committed = new Date().toISOString();
  publishJournal(root, id, journal);
  runFailpoint(hooks, 'after-commit', { id });
  return { id, dir: join(txDir(root), id), steps: journal.steps };
}

/** Applies every step after rechecking its preimage; the first mismatch aborts before any write. */
function applySteps(root, journal, hooks) {
  for (const s of journal.steps) {
    if (s.kind !== 'file') continue;
    if (!sameImage(root, s.path, s.before)) {
      throw new IntentIoError('preimage-changed', `${s.path} changed after the transaction was prepared; nothing was published`, { path: s.path });
    }
  }
  for (const s of journal.steps) {
    if (s.kind === 'file') {
      runFailpoint(hooks, 'before-file', { path: s.path });
      if (s.after.exists) writeFileAtomic(confine(root, s.path), imageBuf(s.after));
      else rmSync(confine(root, s.path), { force: true });
      runFailpoint(hooks, 'after-file', { path: s.path });
    } else {
      runFailpoint(hooks, 'before-move', { from: s.from, to: s.to });
      const from = confine(root, s.from);
      const to = confine(root, s.to);
      mkdirSync(dirname(to), { recursive: true });
      renameSync(from, to);
      runFailpoint(hooks, 'after-move', { from: s.from, to: s.to });
    }
  }
}

/**
 * Explicit recovery of one transaction id (contract C-05). Rolls forward: a step already at its
 * after image is skipped, a step still at its before image is applied, and anything else stops
 * with a conflict that preserves the external edit. Re-entry is idempotent.
 */
export function recoverTransaction(root, id, { token = null, timeoutMs = DEFAULT_TIMEOUT_MS, hooks } = {}) {
  const p = journalPath(root, id);
  if (!existsSync(p)) throw new IntentIoError('no-such-transaction', `no journal at ${TX_DIR_REL}/${id}/journal.json`);
  const owner = readLockOwner(root);
  if (owner && !(token && owner.nonce === token.nonce)) {
    const liveness = ownerLiveness(owner);
    if (liveness !== 'dead') {
      throw new IntentIoError('busy', `the intent lock is held by a ${liveness} owner (pid ${owner.pid ?? '?'} on ${owner.host ?? '?'}); recovery refuses to reclaim it`, { owner, liveness });
    }
    unlinkSync(lockPath(root)); // explicit reclaim of a provably dead owner, never a timeout
  }
  return withIntentLock(
    root,
    () => {
      let journal;
      try {
        journal = JSON.parse(readFileSync(p, 'utf8'));
      } catch (e) {
        throw new IntentIoError('corrupt-journal', `${TX_DIR_REL}/${id}/journal.json is not readable JSON: ${e.message}`);
      }
      const log = [];
      if (journal.phase === 'committed') return { id, phase: 'committed', applied: 0, log: ['already committed; nothing to do'] };
      let applied = 0;
      for (const s of journal.steps ?? []) {
        if (s.kind === 'file') {
          if (sameImage(root, s.path, s.after)) {
            log.push(`${s.path}: already at the after image`);
            continue;
          }
          if (!sameImage(root, s.path, s.before)) {
            throw new IntentIoError('recovery-conflict', `${s.path} matches neither the recorded before nor after image; it was edited outside my-flow and was left untouched`, { path: s.path, id });
          }
          runFailpoint(hooks, 'recover-before-file', { path: s.path });
          if (s.after.exists) writeFileAtomic(confine(root, s.path), imageBuf(s.after));
          else rmSync(confine(root, s.path), { force: true });
          applied++;
          log.push(`${s.path}: rolled forward to the after image`);
        } else {
          const from = confine(root, s.from);
          const to = confine(root, s.to);
          const hasFrom = existsSync(from);
          const hasTo = existsSync(to);
          if (hasTo && !hasFrom) {
            log.push(`${s.from} -> ${s.to}: already moved`);
            continue;
          }
          if (hasFrom && hasTo) {
            throw new IntentIoError('recovery-conflict', `${s.from} and ${s.to} both exist; recovery will not choose between two copies`, { id, from: s.from, to: s.to });
          }
          if (!hasFrom && !hasTo) {
            throw new IntentIoError('recovery-conflict', `neither ${s.from} nor ${s.to} exists; the recorded relocation cannot be completed`, { id, from: s.from, to: s.to });
          }
          runFailpoint(hooks, 'recover-before-move', { from: s.from, to: s.to });
          mkdirSync(dirname(to), { recursive: true });
          renameSync(from, to);
          applied++;
          log.push(`${s.from} -> ${s.to}: relocation completed`);
        }
      }
      journal.phase = 'committed';
      journal.committed = new Date().toISOString();
      journal.recovered = (journal.recovered ?? 0) + 1;
      publishJournal(root, id, journal);
      return { id, phase: 'committed', applied, log };
    },
    { purpose: `recover:${id}`, timeoutMs, token }
  );
}

/** Original bytes kept by a transaction, for inspection after a successful publication. */
export function transactionJournal(root, id) {
  const p = journalPath(root, id);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}



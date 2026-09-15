/**
 * my-flow change identity and lifecycle (contracts C-01 and C-02).
 *
 * `changes/<slug>/change.json` owns a change's stable identity and its lifecycle metadata, and
 * nothing else: task progress and blockers stay in `tasks.md`, which remains the only ledger.
 *
 *   { schemaVersion, id, slug, kind, stage, revision, updated, children, review, verification }
 *
 * The UUID is generated once and never changes, so links survive renumbering, a title edit, a
 * rename of the directory and the move into `changes/archive/`. `revision` is compare-and-swap
 * lifecycle metadata for concurrent writers, never a progress counter.
 *
 * Every function takes `root` explicitly and only reads, except the two writers, which require
 * the caller's C-09 lock token so a manifest is never written outside the coordinated protocol.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { IntentIoError, holdsLock, writeFileAtomic } from './intent-io.mjs';

export const MANIFEST_FILE = 'change.json';
export const STAGES = ['new', 'interview', 'mf-plan', 'execute', 'done', 'archived'];
export const KINDS = ['change', 'umbrella'];
export const REVIEW_LANES = ['low', 'medium', 'high'];
const SCHEMA_VERSION = 2;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

const changesDir = (root) => join(root, 'changes');
const archiveDir = (root) => join(changesDir(root), 'archive');
export const manifestPath = (dir) => join(dir, MANIFEST_FILE);
const diag = (code, message, extra = {}) => ({ code, message, ...extra });

/** Parsed `change.json`, or null when it is absent (a legacy change) or unreadable. */
export function readManifest(dir) {
  const p = manifestPath(dir);
  if (!existsSync(p)) return null;
  try {
    const m = JSON.parse(readFileSync(p, 'utf8'));
    return m && typeof m === 'object' && !Array.isArray(m) ? m : null;
  } catch {
    return null;
  }
}

/** A fresh manifest value. Pure: the caller decides when and how it reaches disk. */
export function newManifest(slug, { kind = 'change', stage = 'new', id = randomUUID(), now = new Date() } = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    slug,
    kind,
    stage,
    revision: 1,
    updated: now.toISOString(),
    children: [],
    review: null,
    verification: { highWater: 0, head: null },
  };
}

/**
 * Structural checks for one manifest, independent of the rest of the repository.
 * `validateChildren` adds the checks that need the index.
 */
export function validateManifest(manifest, { path = MANIFEST_FILE, slug = null } = {}) {
  const errors = [];
  const bad = (message, extra) => errors.push(diag('bad-manifest', message, { path, ...extra }));
  if (!manifest || typeof manifest !== 'object') return [diag('bad-manifest', `${path} is not a JSON object`, { path })];
  if (manifest.schemaVersion !== SCHEMA_VERSION) bad(`schemaVersion must be ${SCHEMA_VERSION} (got ${JSON.stringify(manifest.schemaVersion)})`);
  if (typeof manifest.id !== 'string' || !UUID_RE.test(manifest.id)) bad(`id must be a UUID (got ${JSON.stringify(manifest.id)})`);
  if (typeof manifest.slug !== 'string' || !SLUG_RE.test(manifest.slug)) bad(`slug must be kebab-case (got ${JSON.stringify(manifest.slug)})`);
  else if (slug && manifest.slug !== slug) bad(`slug "${manifest.slug}" does not match its directory "${slug}"`);
  if (!KINDS.includes(manifest.kind)) bad(`kind must be one of ${KINDS.join(', ')} (got ${JSON.stringify(manifest.kind)})`);
  if (!STAGES.includes(manifest.stage)) bad(`stage must be one of ${STAGES.join(', ')} (got ${JSON.stringify(manifest.stage)})`);
  if (!Number.isInteger(manifest.revision) || manifest.revision < 1) bad(`revision must be a positive integer (got ${JSON.stringify(manifest.revision)})`);
  if (manifest.updated !== undefined && Number.isNaN(Date.parse(manifest.updated))) bad(`updated must be an ISO timestamp (got ${JSON.stringify(manifest.updated)})`);
  if (!Array.isArray(manifest.children)) bad('children must be an array');
  else {
    const seen = new Set();
    manifest.children.forEach((c, i) => {
      const where = `children[${i}]`;
      if (!c || typeof c !== 'object') return bad(`${where} must be an object`);
      if (typeof c.repo !== 'string' || !c.repo) bad(`${where}.repo must be "self" or a repository alias`);
      if (typeof c.changeId !== 'string' || !UUID_RE.test(c.changeId)) bad(`${where}.changeId must be a UUID`);
      if (c.after !== undefined && (!Array.isArray(c.after) || c.after.some((a) => !UUID_RE.test(a)))) bad(`${where}.after must be a list of UUIDs`);
      const key = `${c.repo}/${c.changeId}`;
      if (seen.has(key)) bad(`${where} repeats child ${key}`);
      seen.add(key);
    });
    const ids = new Set(manifest.children.map((c) => c.changeId));
    manifest.children.forEach((c, i) => {
      for (const a of c?.after ?? []) if (!ids.has(a)) bad(`children[${i}].after names ${a}, which is not a sibling child`);
      if ((c?.after ?? []).includes(c.changeId)) bad(`children[${i}] lists itself in after`);
    });
    if (manifest.id && ids.has(manifest.id)) bad('a change cannot be its own child');
  }
  const v = manifest.verification;
  if (!v || typeof v !== 'object') bad('verification must be an object');
  else {
    if (!Number.isInteger(v.highWater) || v.highWater < 0) bad('verification.highWater must be a non-negative integer');
    if (v.head !== null && (typeof v.head !== 'object' || !Number.isInteger(v.head?.sequence))) bad('verification.head must be null or an attempt record');
    if (v.head && v.head.sequence > v.highWater) bad(`verification.head.sequence ${v.head.sequence} is beyond the high-water mark ${v.highWater}`);
  }
  if (manifest.review !== null && manifest.review !== undefined) {
    if (typeof manifest.review !== 'object') bad('review must be null or an object');
    else if (manifest.review.lane !== undefined && !REVIEW_LANES.includes(manifest.review.lane)) bad(`review.lane must be one of ${REVIEW_LANES.join(', ')}`);
  }
  return errors;
}

// ---------------------------------------------------------------- the repository index
const listDirs = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_'))
        .map((d) => d.name)
        .sort()
    : [];

/**
 * Every change this repository knows, active and archived, as
 * `[{ id, slug, kind, stage, location, dir, rel, dirName, schemaVersion, manifest }]`.
 *
 * A legacy change with no manifest is listed with `id: null` and `schemaVersion: 1`: it stays
 * readable and addressable by name, it simply has no stable identity to link to yet.
 * Duplicate UUIDs are reported, never silently resolved to one of the two.
 */
export function changeIndex(root) {
  const entries = [];
  const diagnostics = [];
  const add = (dirName, location, dir) => {
    const manifest = readManifest(dir);
    const rel = location === 'active' ? `changes/${dirName}` : `changes/archive/${dirName}`;
    if (manifest) {
      const errors = validateManifest(manifest, { path: `${rel}/${MANIFEST_FILE}`, slug: location === 'active' ? dirName : null });
      diagnostics.push(...errors);
    }
    entries.push({
      id: manifest?.id ?? null,
      slug: manifest?.slug ?? dirName,
      dirName,
      kind: manifest?.kind ?? 'change',
      stage: manifest?.stage ?? (location === 'archive' ? 'archived' : null),
      location,
      dir,
      rel,
      schemaVersion: manifest ? manifest.schemaVersion : 1,
      manifest,
    });
  };
  for (const name of listDirs(changesDir(root))) {
    if (name === 'archive') continue;
    add(name, 'active', join(changesDir(root), name));
  }
  for (const name of listDirs(archiveDir(root))) add(name, 'archive', join(archiveDir(root), name));

  const byId = new Map();
  for (const e of entries) {
    if (!e.id) continue;
    if (byId.has(e.id)) {
      diagnostics.push(diag('duplicate-identity', `change id ${e.id} is claimed by ${byId.get(e.id).rel} and ${e.rel}`, { id: e.id, paths: [byId.get(e.id).rel, e.rel] }));
      continue;
    }
    byId.set(e.id, e);
  }
  return { entries, byId, diagnostics };
}

/**
 * Resolves a UUID or a slug to one index entry. An active change wins over an archived one with
 * the same slug, because that is the one a person means when they type a name; a UUID is exact.
 * A duplicate UUID is an error, not a guess.
 */
export function resolveChange(root, idOrSlug, index = changeIndex(root)) {
  if (typeof idOrSlug !== 'string' || !idOrSlug) return { error: 'bad-reference', message: 'a change reference must be a non-empty UUID or slug' };
  if (UUID_RE.test(idOrSlug)) {
    const clash = index.diagnostics.find((d) => d.code === 'duplicate-identity' && d.id === idOrSlug);
    if (clash) return { error: 'duplicate-identity', message: clash.message, paths: clash.paths };
    const hit = index.byId.get(idOrSlug);
    return hit ? { entry: hit } : { error: 'no-such-change', message: `no change carries the id ${idOrSlug}` };
  }
  const matches = index.entries.filter((e) => e.slug === idOrSlug || e.dirName === idOrSlug);
  const active = matches.find((e) => e.location === 'active');
  if (active) return { entry: active };
  if (matches.length === 1) return { entry: matches[0] };
  if (matches.length > 1) {
    // archived changes may repeat a slug across dates; the newest directory name wins by sort
    return { entry: matches.sort((a, b) => a.dirName.localeCompare(b.dirName)).at(-1), ambiguous: matches.map((m) => m.rel) };
  }
  return { error: 'no-such-change', message: `no active or archived change is called "${idOrSlug}"` };
}

/** Umbrella children resolved against the index, with unresolved and cyclic references named. */
export function resolveChildren(root, manifest, index = changeIndex(root)) {
  const children = [];
  const diagnostics = [];
  for (const c of manifest?.children ?? []) {
    if (c.repo !== 'self') {
      children.push({ ...c, resolved: false, reason: 'cross-repository children resolve through the local repository alias map', entry: null });
      continue;
    }
    const entry = index.byId.get(c.changeId) ?? null;
    if (!entry) {
      diagnostics.push(diag('unresolved-child', `child ${c.changeId} is not a change in this repository`, { id: c.changeId }));
      children.push({ ...c, resolved: false, reason: 'no change in this repository carries that id', entry: null });
      continue;
    }
    children.push({ ...c, resolved: true, reason: null, entry });
  }
  // a cycle through umbrella membership, however long
  const seen = new Set();
  const stack = [];
  const walk = (id) => {
    if (stack.includes(id)) {
      diagnostics.push(diag('child-cycle', `umbrella membership cycle: ${[...stack.slice(stack.indexOf(id)), id].join(' -> ')}`, { id }));
      return;
    }
    if (seen.has(id)) return;
    seen.add(id);
    stack.push(id);
    for (const c of index.byId.get(id)?.manifest?.children ?? []) if (c.repo === 'self') walk(c.changeId);
    stack.pop();
  };
  if (manifest?.id) walk(manifest.id);
  return { children, diagnostics };
}

// ---------------------------------------------------------------- writers
const requireToken = (root, token, what) => {
  if (!holdsLock(root, token)) throw new IntentIoError('lock-lost', `${what} requires the live intent lock token`);
};

/** Creates `change.json` for a change that has none. Refuses to overwrite an existing identity. */
export function createManifest(root, dir, slug, { kind = 'change', stage = 'new', id, now } = {}, token) {
  requireToken(root, token, 'createManifest');
  if (existsSync(manifestPath(dir))) throw new IntentIoError('identity-exists', `${slug} already has a ${MANIFEST_FILE}; an identity is generated once and never replaced`);
  const manifest = newManifest(slug, { kind, stage, ...(id ? { id } : {}), ...(now ? { now } : {}) });
  const errors = validateManifest(manifest, { slug });
  if (errors.length) throw new IntentIoError('bad-manifest', errors[0].message, { errors });
  writeFileAtomic(manifestPath(dir), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

/**
 * Compare-and-swap update of lifecycle metadata. `expectedRevision` is optional; when it is
 * given and does not match, the write is refused so a stale writer cannot undo a newer decision.
 * Identity, children, review and verification are never changed here.
 */
export function updateLifecycle(root, dir, patch, { expectedRevision = null, now = new Date() } = {}, token) {
  requireToken(root, token, 'updateLifecycle');
  const current = readManifest(dir);
  if (!current) throw new IntentIoError('no-identity', `${dir} has no ${MANIFEST_FILE}; upgrade the change before using lifecycle metadata`);
  if (expectedRevision !== null && current.revision !== expectedRevision) {
    throw new IntentIoError('stale-revision', `lifecycle revision is ${current.revision}, not the expected ${expectedRevision}; re-read the manifest and retry`, { current: current.revision, expected: expectedRevision });
  }
  if (patch.stage !== undefined && !STAGES.includes(patch.stage)) throw new IntentIoError('bad-manifest', `unknown stage "${patch.stage}" (expected one of: ${STAGES.join(', ')})`);
  const next = {
    ...current,
    ...(patch.stage !== undefined ? { stage: patch.stage } : {}),
    ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
    ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
    ...(patch.review !== undefined ? { review: patch.review } : {}),
    ...(patch.children !== undefined ? { children: patch.children } : {}),
    revision: current.revision + 1,
    updated: now.toISOString(),
  };
  const errors = validateManifest(next, { slug: next.slug });
  if (errors.length) throw new IntentIoError('bad-manifest', errors[0].message, { errors });
  writeFileAtomic(manifestPath(dir), JSON.stringify(next, null, 2) + '\n');
  return next;
}

/** Lifecycle projection for status output: identity and stage, with no session activity mixed in. */
export function lifecycleOf(entry) {
  return {
    id: entry.id,
    slug: entry.slug,
    kind: entry.kind,
    stage: entry.stage,
    revision: entry.manifest?.revision ?? null,
    updated: entry.manifest?.updated ?? null,
    location: entry.location,
    schemaVersion: entry.schemaVersion,
    verification: entry.manifest?.verification ?? null,
  };
}


// ---------------------------------------------------------------- sessions (contract C-06)
/**
 * Session activity is not lifecycle. `change.json` says where a change is in its life; a session
 * lease says which session is working on it right now, and lives in its own scratch file so two
 * sessions can never overwrite each other's binding.
 *
 * Losing scratch loses leases. It never loses lifecycle or verification history.
 */
export const SESSION_TTL_ENV = 'MY_FLOW_EXECUTE_GUARD_TTL_HOURS';
export const DEFAULT_TTL_HOURS = 12;
export const SESSION_SOURCES = ['option', 'env', 'host', 'transcript', 'unidentified'];
const sessionsDir = (root) => join(root, '.my-flow', 'state', 'sessions');
const hashKey = (sessionId) => createHash('sha256').update(String(sessionId)).digest('hex');
export const sessionPath = (root, key) => join(sessionsDir(root), `${key}.json`);

/** TTL in hours: the explicit value, then the environment variable, then 12. Never zero. */
export function ttlHours({ hours, env = process.env } = {}) {
  for (const v of [hours, env[SESSION_TTL_ENV]]) {
    const n = Number(v);
    if (v !== undefined && v !== '' && Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_TTL_HOURS;
}

/**
 * Who is asking, in the one precedence order every consumer shares (C-06): an explicit
 * `--session`, then `MY_FLOW_SESSION_ID`, then the host's own documented session id from a hook
 * payload, then a hash of a non-empty transcript path, and otherwise unidentified.
 *
 * The working directory and the process id are deliberately not in that list: neither identifies
 * a session, and using either would let two sessions in one checkout claim to be the same one.
 */
export function resolveSessionIdentity({ option = null, env = process.env, hook = null } = {}) {
  const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const fromOption = clean(option);
  if (fromOption) return { sessionId: fromOption, key: hashKey(fromOption), source: 'option' };
  const fromEnv = clean(env.MY_FLOW_SESSION_ID);
  if (fromEnv) return { sessionId: fromEnv, key: hashKey(fromEnv), source: 'env' };
  const fromHost = clean(hook?.session_id);
  if (fromHost) return { sessionId: fromHost, key: hashKey(fromHost), source: 'host' };
  const transcript = clean(hook?.transcript_path);
  if (transcript) {
    const canonical = transcript.replace(/\\/g, '/');
    return { sessionId: `transcript:${hashKey(canonical).slice(0, 16)}`, key: hashKey(`transcript:${canonical}`), source: 'transcript' };
  }
  return { sessionId: null, key: null, source: 'unidentified' };
}

const leaseState = (lease, now, hours) => {
  if (!lease || typeof lease !== 'object') return 'corrupt';
  if (lease.schemaVersion !== SCHEMA_VERSION) return 'corrupt';
  if (typeof lease.sessionId !== 'string' || !lease.sessionId) return 'corrupt';
  const until = Date.parse(lease.leaseUntil ?? '');
  if (!Number.isFinite(until)) return 'corrupt';
  // a lease that claims to run far past any possible TTL is not trusted, it is repaired
  if (until > now + 2 * hours * 3600_000) return 'corrupt';
  return until > now ? 'live' : 'expired';
};

/** One lease file, with the state it is actually in. `null` when the file is not there at all. */
export function readLease(root, key, { now = Date.now(), hours } = {}) {
  const p = sessionPath(root, key);
  if (!existsSync(p)) return null;
  let lease;
  try {
    lease = JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return { key, state: 'corrupt', lease: null, reason: 'the lease file is not readable JSON' };
  }
  const state = leaseState(lease, now, ttlHours({ hours }));
  return { key, state, lease, reason: state === 'corrupt' ? 'the lease file does not describe a usable session binding' : null };
}

/** Every lease this root knows, live, expired and corrupt alike. Scratch loss simply yields none. */
export function listLeases(root, { now = Date.now(), hours } = {}) {
  const dir = sessionsDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readLease(root, f.slice(0, -5), { now, hours }))
    .filter(Boolean)
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * What this identity is bound to right now. A known key with no valid binding is *not* a reason
 * to fall back to the global pointer: that pointer belongs to whoever wrote it, and borrowing it
 * is how one session ends up enforcing another session's guard.
 */
export function currentSession(root, identity, { now = Date.now(), hours } = {}) {
  const leases = listLeases(root, { now, hours });
  const live = leases.filter((l) => l.state === 'live');
  if (identity?.key) {
    const mine = readLease(root, identity.key, { now, hours });
    if (mine?.state === 'live') return { source: identity.source, sessionId: identity.sessionId, lease: mine.lease, state: 'live', ambiguous: false };
    return {
      source: identity.source,
      sessionId: identity.sessionId,
      lease: null,
      state: mine ? mine.state : 'none',
      ambiguous: false,
      reason: mine ? `this session's lease is ${mine.state}` : 'this session holds no lease',
    };
  }
  // unidentified: another session's live lease is never adopted, and never enforced against
  if (live.length || leases.some((l) => l.state === 'corrupt')) {
    return { source: 'unidentified', sessionId: null, lease: null, state: 'ambiguous', ambiguous: true, reason: `${live.length} live session lease(s) exist and this caller is unidentified`, live: live.map((l) => l.lease.changeId) };
  }
  return { source: 'unidentified', sessionId: null, lease: null, state: 'none', ambiguous: false, reason: 'no session leases exist; the legacy pointer applies' };
}

/**
 * Bind this session to a change, or renew its own binding. Only one live execute lease is allowed
 * per physical project root, because only one writer can hold the working tree; every other stage
 * may be held by any number of sessions at once. Releasing affects only the requesting session.
 */
export function acquireLease(root, { key, sessionId, changeId, stage, hours, now = Date.now(), takeOver = false }, token) {
  requireToken(root, token, 'acquireLease');
  if (!key || !sessionId) throw new IntentIoError('no-session', 'a session lease needs an identified session; pass --session or set MY_FLOW_SESSION_ID');
  const ttl = ttlHours({ hours });
  if (stage === 'execute') {
    for (const other of listLeases(root, { now, hours })) {
      if (other.key === key || other.state !== 'live') continue;
      if (other.lease.stage !== 'execute') continue;
      if (!takeOver) {
        throw new IntentIoError('execute-lease-held', `another session already holds the execute lease in this project root (change ${other.lease.changeId}, until ${other.lease.leaseUntil}); one physical root has one writer`, { holder: other.lease.sessionId });
      }
    }
  }
  const existing = readLease(root, key, { now, hours });
  const lease = {
    schemaVersion: SCHEMA_VERSION,
    sessionId,
    changeId,
    stage,
    updated: new Date(now).toISOString(),
    leaseUntil: new Date(now + ttl * 3600_000).toISOString(),
    revision: (existing?.lease?.revision ?? 0) + 1,
  };
  mkdirSync(sessionsDir(root), { recursive: true });
  writeFileAtomic(sessionPath(root, key), JSON.stringify(lease, null, 2) + '\n');
  return lease;
}

/** Releases only the requesting session's lease. Another session's lease is never touched. */
export function releaseLease(root, key, token) {
  requireToken(root, token, 'releaseLease');
  const p = sessionPath(root, key);
  if (!existsSync(p)) return false;
  rmSync(p, { force: true });
  return true;
}

/**
 * An expired lease may be taken over explicitly by a new actor. Nothing reclaims a lease in the
 * background: a lease that is merely old still names its holder until somebody decides.
 */
export function recoverExpiredLease(root, key, { now = Date.now(), hours } = {}, token) {
  requireToken(root, token, 'recoverExpiredLease');
  const existing = readLease(root, key, { now, hours });
  if (!existing) throw new IntentIoError('no-such-lease', 'there is no lease at that key to recover');
  if (existing.state === 'live') throw new IntentIoError('lease-live', 'that lease is still live; it is not recovered, it is waited for or released by its owner');
  rmSync(sessionPath(root, key), { force: true });
  return existing;
}

/**
 * What the dashboard must not let a person edit right now (contract C-06).
 *
 * The lock is the union of the live *execute* leases, and it is scoped: each lease locks its own
 * change's intent files and the main spec capabilities that change's deltas claim. Two changes
 * being worked on at once therefore do not lock each other, and a change nobody is executing is
 * not locked at all.
 *
 * This is deliberately more conservative than the Stop hook, which fails open: refusing an edit
 * costs a person a retry, while allowing one during a write costs them their work.
 */
export function editLocks(root, { now = Date.now(), hours } = {}) {
  const leases = listLeases(root, { now, hours });
  const index = changeIndex(root);
  const resolveEntry = (changeRef) => index.byId.get(changeRef) ?? index.entries.find((e) => e.location === 'active' && e.slug === changeRef) ?? null;
  const capabilitiesOf = (dir) => {
    const specs = join(dir, 'specs');
    if (!existsSync(specs)) return [];
    try {
      return readdirSync(specs, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    } catch {
      return [];
    }
  };

  const scopes = [];
  for (const l of leases.filter((x) => x.state === 'live' && x.lease?.stage === 'execute')) {
    const entry = resolveEntry(l.lease.changeId);
    if (!entry) continue; // a lease naming a change this repository does not have locks nothing
    scopes.push({
      change: entry.slug,
      rel: entry.rel,
      capabilities: capabilitiesOf(entry.dir),
      reason: 'lease',
      message: `"${entry.slug}" is at stage execute in another session (lease until ${l.lease.leaseUntil}); its intent files and the specs it claims are read-only here`,
    });
  }
  // a corrupt lease is not ignored: if it still names a change, that change is held read-only
  const unidentifiable = [];
  for (const l of leases.filter((x) => x.state === 'corrupt')) {
    const ref = l.lease?.changeId;
    const entry = ref ? resolveEntry(ref) : null;
    if (entry) {
      scopes.push({
        change: entry.slug,
        rel: entry.rel,
        capabilities: capabilitiesOf(entry.dir),
        reason: 'corrupt-lease',
        message: `the session lease for "${entry.slug}" is corrupt; that change is read-only until the lease file is repaired or removed (.my-flow/state/sessions/${l.key.slice(0, 12)}...json)`,
      });
    } else {
      unidentifiable.push(l.key);
    }
  }
  // a corrupt lease that names nothing could be about any change, so every intent write waits
  const repair = unidentifiable.length
    ? {
        keys: unidentifiable,
        message: `${unidentifiable.length} session lease file(s) under .my-flow/state/sessions/ are unreadable and name no change, so no intent file can be saved until they are repaired or removed`,
      }
    : null;

  // the pre-v2 global lock, kept for a project with no session data at all
  let legacy = null;
  if (!leases.length) {
    const state = (() => {
      try {
        return JSON.parse(readFileSync(join(root, '.my-flow', 'state', 'current-change.json'), 'utf8'));
      } catch {
        return null;
      }
    })();
    const t = typeof state?.updated === 'string' ? Date.parse(state.updated) : NaN;
    const fresh = Number.isFinite(t) && now - t <= ttlHours({ hours }) * 3600_000;
    if (state?.stage === 'execute' && fresh) {
      legacy = {
        change: typeof state.change === 'string' ? state.change : null,
        message: `the dashboard is read-only while "${state.change ?? 'the current change'}" is at stage execute; an agent is writing`,
      };
    }
  }
  return { scopes, legacy, repair };
}

/**
 * Is this repository-relative path locked, and why? Returns `null` when the path is free.
 * Paths are matched by scope: `changes/<slug>/...` for the change itself, and
 * `specs/<capability>/...` for the capabilities that change's deltas claim.
 */
export function lockFor(locks, rel) {
  const path = String(rel ?? '').replace(/\\/g, '/');
  if (locks.repair) return { change: null, stage: 'execute', reason: 'corrupt-lease', message: locks.repair.message };
  for (const scope of locks.scopes) {
    if (path === scope.rel || path.startsWith(`${scope.rel}/`)) return { change: scope.change, stage: 'execute', reason: scope.reason, message: scope.message };
    for (const cap of scope.capabilities) {
      if (path === `specs/${cap}/spec.md` || path.startsWith(`specs/${cap}/`)) {
        return { change: scope.change, stage: 'execute', reason: scope.reason, message: `${scope.message} (specs/${cap} is claimed by its delta)` };
      }
    }
  }
  if (locks.legacy) return { change: locks.legacy.change, stage: 'execute', reason: 'legacy', message: locks.legacy.message };
  return null;
}

// ---------------------------------------------------------------- repository aliases (C-02)
/**
 * Cross-repository umbrella children are named by an alias, and the alias map is local: it lives
 * in this checkout's scratch and is written only by `spec repo add`.
 *
 * The reason it is not a path in the manifest, and never an API parameter: a caller that can
 * supply a filesystem root can read any repository the server can reach. An alias can only name
 * something a person already decided to register here.
 */
export const REPOSITORIES_FILE = '.my-flow/state/repositories.json';
const ALIAS_RE = /^[a-z0-9][a-z0-9-]*$/;
const repositoriesPath = (root) => join(root, ...REPOSITORIES_FILE.split('/'));

/** The local alias map as `{ alias: { root } }`; an unreadable or absent file is simply empty. */
export function readRepositories(root) {
  try {
    const parsed = JSON.parse(readFileSync(repositoriesPath(root), 'utf8'));
    const out = {};
    for (const [alias, value] of Object.entries(parsed?.repositories ?? {})) {
      if (ALIAS_RE.test(alias) && typeof value?.root === 'string') out[alias] = { root: value.root };
    }
    return out;
  } catch {
    return {};
  }
}

/** Registers one alias. The path must exist, resolve, and look like an intent root. */
export function addRepository(root, alias, path, token) {
  requireToken(root, token, 'addRepository');
  if (!ALIAS_RE.test(String(alias ?? ''))) throw new IntentIoError('bad-alias', `"${alias}" is not a valid repository alias (lower-case letters, digits and hyphens)`);
  if (alias === 'self') throw new IntentIoError('bad-alias', '"self" is reserved for this repository');
  let resolved;
  try {
    resolved = realpathSync.native(resolve(path ?? ''));
  } catch {
    throw new IntentIoError('no-such-repository', `${path} does not exist`);
  }
  if (!existsSync(join(resolved, 'changes')) && !existsSync(join(resolved, 'specs'))) {
    throw new IntentIoError('not-an-intent-root', `${resolved} has neither changes/ nor specs/; it is not a my-flow intent root`);
  }
  const repositories = { ...readRepositories(root), [alias]: { root: resolved } };
  mkdirSync(dirname(repositoriesPath(root)), { recursive: true });
  writeFileAtomic(repositoriesPath(root), JSON.stringify({ schemaVersion: SCHEMA_VERSION, repositories }, null, 2) + '\n');
  return { alias, root: resolved };
}

/** Removes one alias. Children that named it become unresolved, never silently local. */
export function removeRepository(root, alias, token) {
  requireToken(root, token, 'removeRepository');
  const repositories = readRepositories(root);
  if (!(alias in repositories)) return false;
  delete repositories[alias];
  writeFileAtomic(repositoriesPath(root), JSON.stringify({ schemaVersion: SCHEMA_VERSION, repositories }, null, 2) + '\n');
  return true;
}

/**
 * A child's state, derived from the child's own files. Never a counter copied into the parent:
 * the umbrella records which children it has, and their progress is read fresh every time.
 */
function childState(childRoot, changeId) {
  const index = changeIndex(childRoot);
  const entry = index.byId.get(changeId) ?? null;
  if (!entry) return null;
  const text = (() => {
    try {
      return readFileSync(join(entry.dir, 'tasks.md'), 'utf8');
    } catch {
      return null;
    }
  })();
  const done = text ? (text.match(/^\s*- \[x\]/gim) ?? []).length : 0;
  const open = text ? (text.match(/^\s*- \[ \]/gm) ?? []).length : 0;
  const abandoned = entry.location === 'archive' && /-abandoned$/.test(entry.dirName);
  return {
    id: entry.id,
    slug: entry.slug,
    kind: entry.kind,
    stage: entry.stage,
    location: entry.location,
    abandoned,
    tasks: text ? { done, total: done + open } : null,
    verification: entry.manifest?.verification ?? null,
  };
}

/**
 * Every child of an umbrella, resolved and derived. A child in another repository resolves only
 * through a registered alias, and what comes back is identity and state: never a path, never a
 * file. An unavailable child stays visible and unresolved rather than being dropped.
 */
export function resolveUmbrella(root, manifest) {
  const repositories = readRepositories(root);
  const children = [];
  const blockers = [];
  for (const c of manifest?.children ?? []) {
    const base = { repo: c.repo, changeId: c.changeId, after: c.after ?? [] };
    if (c.repo === 'self') {
      const state = childState(root, c.changeId);
      if (!state) {
        blockers.push({ code: 'unresolved-child', message: `child ${c.changeId} is not a change in this repository` });
        children.push({ ...base, available: true, resolved: false, state: null, reason: 'no change in this repository carries that id' });
        continue;
      }
      children.push({ ...base, available: true, resolved: true, state, reason: null });
      continue;
    }
    const alias = repositories[c.repo];
    if (!alias) {
      blockers.push({ code: 'unavailable-repository', message: `child ${c.changeId} lives in repository "${c.repo}", which is not registered here (spec repo add ${c.repo} --path <path>)` });
      children.push({ ...base, available: false, resolved: false, state: null, reason: `repository alias "${c.repo}" is not registered in this checkout` });
      continue;
    }
    const state = childState(alias.root, c.changeId);
    if (!state) {
      blockers.push({ code: 'unresolved-child', message: `child ${c.changeId} was not found in repository "${c.repo}"` });
      children.push({ ...base, available: true, resolved: false, state: null, reason: `repository "${c.repo}" is registered, but carries no change with that id` });
      continue;
    }
    children.push({ ...base, available: true, resolved: true, state, reason: null });
  }
  // ordering constraints between siblings, and children that can never satisfy one
  const byId = new Map(children.map((c) => [c.changeId, c]));
  for (const c of children) {
    for (const a of c.after) {
      const prerequisite = byId.get(a);
      if (!prerequisite) blockers.push({ code: 'unknown-prerequisite', message: `child ${c.changeId} waits for ${a}, which is not a sibling child` });
      else if (prerequisite.state?.abandoned) blockers.push({ code: 'abandoned-prerequisite', message: `child ${c.changeId} waits for ${a}, which was abandoned; an abandoned child never satisfies an integration prerequisite` });
    }
    if (c.state?.abandoned) blockers.push({ code: 'abandoned-child', message: `child ${c.state.slug} was abandoned; it cannot count towards this umbrella integration` });
  }
  const complete = children.filter((c) => c.resolved && c.state?.tasks && c.state.tasks.total > 0 && c.state.tasks.done === c.state.tasks.total && !c.state.abandoned);
  return {
    children,
    blockers,
    derived: { total: children.length, resolved: children.filter((c) => c.resolved).length, complete: complete.length },
    // the umbrella's own boxes are never ticked by this: child completion is derived state, and
    // an integration claim still needs the umbrella's own evidence
    note: 'child completion is derived; it never ticks a task in this umbrella',
  };
}

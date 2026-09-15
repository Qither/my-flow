/**
 * The one adapter both hooks read session and task state through (design D5, contracts C-06,
 * C-08). Before this existed each hook parsed the state file and `tasks.md` itself, and the two
 * copies could disagree about what "current" meant.
 *
 * Two properties matter more than completeness here:
 *
 *   - it never throws. A hook that crashes takes the host session with it, so every failure
 *     degrades to "I do not know", and a hook that does not know allows;
 *   - it tolerates a missing library. Hooks run from an installed plugin cache that may be
 *     half-updated or older than this file, so the shared libraries are imported dynamically and
 *     a small inline reader takes over when they are not there. `degraded` says which happened.
 *
 * The rule the adapter exists to enforce: an unidentified caller never borrows another session's
 * binding. Doing so is how one session ends up enforcing another session's task guard.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', '..', 'scripts', 'lib');
export const DEFAULT_TTL_HOURS = 12;

const read = (p) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};
const parse = (p) => {
  try {
    return JSON.parse(read(p) ?? 'null');
  } catch {
    return null;
  }
};

/** The shared TTL, read the same way everywhere: environment variable, then twelve hours. */
export function hookTtlHours(env = process.env) {
  const n = Number(env.MY_FLOW_EXECUTE_GUARD_TTL_HOURS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_HOURS;
}

/** Dynamic import that answers `null` instead of throwing when the library is not installed. */
async function lib(name) {
  try {
    return await import(new URL(`file://${join(LIB, name).replace(/\\/g, '/')}`).href);
  } catch {
    return null;
  }
}

/**
 * The legacy pointer, read exactly as the pre-v2 hooks read it. A stale pointer is not a
 * binding: it yields no change at all, so no caller can act on it by accident.
 */
function legacyPointer(cwd, { now, ttl }) {
  const state = parse(join(cwd, '.my-flow', 'state', 'current-change.json'));
  if (!state?.change) return { change: null, stage: null, fresh: false, source: 'none', reason: 'no legacy pointer exists' };
  const t = typeof state.updated === 'string' ? Date.parse(state.updated) : NaN;
  const fresh = Number.isFinite(t) && now - t <= ttl * 3600_000; // missing or unparseable -> stale
  if (!fresh) return { change: null, stage: null, fresh: false, source: 'none', reason: `the legacy pointer for "${state.change}" is older than ${ttl}h` };
  return { change: state.change, stage: state.stage ?? null, fresh: true, source: 'legacy', reason: null };
}

/**
 * Who this hook invocation is, and what it is bound to.
 *
 * `binding.source` is `lease` when an identified session holds a live lease, `legacy` when an
 * unidentified caller may use the global pointer because no lease could be meant, and `none`
 * otherwise. `ambiguous` marks the case an unidentified caller must not act on: somebody else
 * holds a live lease, so this caller knows neither whose work it is nor whether to guard it.
 */
export async function sessionView(cwd, hookInput = {}, { now = Date.now(), env = process.env } = {}) {
  const ttl = hookTtlHours(env);
  const asLegacy = (reason) => {
    const legacy = legacyPointer(cwd, { now, ttl });
    return {
      degraded: true,
      ttlHours: ttl,
      identity: { sessionId: null, source: 'unidentified' },
      binding: { change: legacy.change, stage: legacy.stage, source: legacy.source, fresh: legacy.fresh, ambiguous: false, reason: legacy.reason ?? reason },
    };
  };
  const state = await lib('intent-state.mjs');
  if (!state?.resolveSessionIdentity) return asLegacy('the shared intent libraries are not installed beside this hook');
  let identity;
  let current;
  try {
    identity = state.resolveSessionIdentity({ env, hook: hookInput });
    current = state.currentSession(cwd, identity, { now });
  } catch {
    return asLegacy('the session state could not be read');
  }
  const base = { degraded: false, ttlHours: ttl, identity: { sessionId: identity.sessionId, source: identity.source } };
  if (current.lease) {
    // a lease is live by construction; its own TTL already decided that
    return { ...base, binding: { change: current.lease.changeId, stage: current.lease.stage, source: 'lease', fresh: true, ambiguous: false, reason: null } };
  }
  if (current.ambiguous) {
    return { ...base, binding: { change: null, stage: null, source: 'none', fresh: false, ambiguous: true, reason: current.reason } };
  }
  // A session with no lease of its own may still read the legacy pointer, but only while no live
  // lease exists anywhere: that is the one condition under which the pointer cannot be another
  // session's work. It is what keeps the pre-v2 backstop working for a host that identifies its
  // sessions but has not bound one yet, without ever enforcing somebody else's guard.
  const anyLive = (() => {
    try {
      return state.listLeases(cwd, { now }).some((l) => l.state === 'live');
    } catch {
      return false;
    }
  })();
  if (anyLive) {
    return { ...base, binding: { change: null, stage: null, source: 'none', fresh: false, ambiguous: false, reason: `${current.reason}; another session holds a live lease, so the legacy pointer is not read` } };
  }
  const legacy = legacyPointer(cwd, { now, ttl });
  return { ...base, binding: { change: legacy.change, stage: legacy.stage, source: legacy.source, fresh: legacy.fresh, ambiguous: false, reason: legacy.reason ?? current.reason } };
}

/**
 * A change's tasks as the hooks need them: how many are ticked, and which unticked ones are not
 * marked blocked. `changeRef` may be a slug or a stable id; both are resolved, because a lease
 * records the id and the legacy pointer records the name.
 */
export async function taskView(cwd, changeRef) {
  if (!changeRef) return null;
  const state = await lib('intent-state.mjs');
  let dir = null;
  let slug = changeRef;
  try {
    const hit = state?.resolveChange?.(cwd, changeRef);
    if (hit?.entry) {
      dir = hit.entry.dir;
      slug = hit.entry.slug;
    }
  } catch {
    /* fall through to the path guesses below */
  }
  const candidates = [dir ? join(dir, 'tasks.md') : null, join(cwd, 'changes', String(changeRef), 'tasks.md'), join(cwd, 'docs', 'changes', `${changeRef}.md`)].filter(Boolean);
  const path = candidates.find((p) => existsSync(p));
  if (!path) return null;

  const graph = await lib('intent-graph.mjs');
  const text = read(path);
  if (text === null) return null;
  if (graph?.parseTasksMarkdown) {
    try {
      const parsed = graph.parseTasksMarkdown(text, { path });
      const remaining = parsed.tasks.filter((t) => !t.checked && !t.blocked).map((t) => `${t.number} ${t.title}`);
      return { change: slug, path, remaining, done: parsed.tasks.filter((t) => t.checked).length, total: parsed.tasks.length, degraded: false };
    } catch {
      /* fall through to the inline reader */
    }
  }
  // inline fallback: the same grammar, read without the library
  const lines = text.split(/\r?\n/);
  const remaining = [];
  let done = 0;
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*- \[[xX]\] \d+\.\d+ /.test(lines[i])) {
      done++;
      total++;
      continue;
    }
    const m = /^\s*- \[ \] (\d+\.\d+ .*)$/.exec(lines[i]);
    if (!m) continue;
    total++;
    let blocked = false;
    for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]) && !/^\s*- \[/.test(lines[j]); j++) {
      if (/blocked:/i.test(lines[j])) blocked = true;
    }
    if (!blocked) remaining.push(m[1].trim());
  }
  return { change: slug, path, remaining, done, total, degraded: true };
}



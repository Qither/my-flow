/**
 * my-flow verification targets (contract C-03).
 *
 * A verification report is worth only as much as the inputs it was taken against, so before any
 * check runs we capture exactly two things and hash them:
 *
 *   - the implementation target: a conservative, repository-wide inventory of the source a check
 *     could read, including staged, unstaged, deleted and non-ignored untracked files;
 *   - the acceptance target: the exact contract text the report claims to have satisfied.
 *
 * Both are recomputed when the checks finish. Any drift means the report describes something
 * other than what was tested, which is INCOMPLETE, never PASS.
 *
 * What hashes can and cannot do: they detect changed inputs. They do not detect a malicious
 * local writer and they do not establish authorship. Provenance is recorded separately and
 * honestly (C-04), never inferred from a digest.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { IntentIoError, holdsLock, writeFileAtomic } from './intent-io.mjs';
import { parseAcceptanceMarkdown, parseTasksMarkdown, readChangeIntentDir } from './intent-graph.mjs';
import { MANIFEST_FILE, readManifest } from './intent-state.mjs';

const GIT_TIMEOUT_MS = 20_000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
/** Intent lives in the acceptance target; excluding it here keeps the two digests disjoint. */
export const INTENT_PREFIXES = ['.git/', '.my-flow/', 'changes/', 'specs/', 'docs/changes/'];
const VIA_LINE_RE = /^<!-- via: .+ -->\s*$/;

export const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');
const toSlash = (p) => p.replace(/\\/g, '/');
const lf = (s) => String(s ?? '').replace(/\r\n/g, '\n');

/**
 * Canonical JSON: object keys sorted by code point, arrays left in their declared order because
 * their order is part of the meaning. Used for every digest so two equal values hash equally.
 */
export function canonicalJson(value) {
  const walk = (v) => {
    if (Array.isArray(v)) return `[${v.map(walk).join(',')}]`;
    if (v && typeof v === 'object') {
      return `{${Object.keys(v)
        .sort()
        .filter((k) => v[k] !== undefined)
        .map((k) => `${JSON.stringify(k)}:${walk(v[k])}`)
        .join(',')}}`;
    }
    return JSON.stringify(v ?? null);
  };
  return walk(value);
}
export const digestOf = (value) => sha256Hex(canonicalJson(value));

// ---------------------------------------------------------------- git
function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'buffer', windowsHide: true, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER });
  return { status: r.status, stdout: r.stdout ?? Buffer.alloc(0), stderr: (r.stderr ?? Buffer.alloc(0)).toString('utf8'), error: r.error ?? null };
}
const gitText = (root, args) => {
  const r = git(root, args);
  return r.status === 0 && !r.error ? r.stdout.toString('utf8') : null;
};
const splitZ = (s) => String(s ?? '').split('\0').filter((t) => t !== '');

/** Is this root inside a Git work tree? A non-Git root needs an explicit approved inventory. */
export function isGitRoot(root) {
  return gitText(root, ['rev-parse', '--is-inside-work-tree'])?.trim() === 'true';
}

// ---------------------------------------------------------------- implementation target
const excluded = (rel) => INTENT_PREFIXES.some((p) => rel === p.slice(0, -1) || rel.startsWith(p));

/** One inventory record. `mode` is `file | symlink | deleted`; `hash` is null only for a deletion. */
function recordFor(root, rel) {
  const abs = join(root, rel);
  let st;
  try {
    st = lstatSync(abs);
  } catch {
    return { path: rel, type: 'deleted', mode: 'deleted', hash: null };
  }
  if (st.isSymbolicLink()) {
    const target = readlinkSync(abs);
    const inside = relative(root, resolve(abs, '..', target));
    if (inside.startsWith('..') || isAbsolute(inside)) {
      throw new IntentIoError('link-escapes-root', `${rel} is a symlink pointing outside the repository (${toSlash(target)}); a verification target cannot include it`);
    }
    return { path: rel, type: 'symlink', mode: 'symlink', hash: sha256Hex(toSlash(target)) };
  }
  if (st.isDirectory()) return null; // Git never lists a directory; a non-Git inventory walks into it
  return { path: rel, type: 'file', mode: st.mode & 0o111 ? 'exec' : 'file', hash: sha256Hex(readFileSync(abs)) };
}

/** Refuses two paths that differ only in case: on Windows they are one file, and the pair lies. */
function assertNoCaseCollision(records) {
  const seen = new Map();
  for (const r of records) {
    const key = r.path.toLowerCase();
    if (seen.has(key) && seen.get(key) !== r.path) {
      throw new IntentIoError('case-collision', `${seen.get(key)} and ${r.path} differ only in case; a verification target cannot describe both on this platform`);
    }
    seen.set(key, r.path);
  }
}

/**
 * The conservative repository-wide implementation inventory (C-03). Tracked files contribute
 * their working-tree bytes regardless of staging; a tracked file deleted in the working tree is
 * recorded explicitly as a deletion rather than silently vanishing; non-ignored untracked files
 * are included. Ignored files are *not* implicitly verified: a required one must be declared.
 */
export function implementationInventory(root, { declaredInputs = [], allowNonGit = false } = {}) {
  const diagnostics = [];
  if (!isGitRoot(root)) {
    if (!allowNonGit) {
      throw new IntentIoError('unsupported-input', `${root} is not inside a Git work tree; a non-Git root needs an explicit approved input inventory`);
    }
    const walked = [];
    const walk = (dir) => {
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        const rel = toSlash(relative(root, join(dir, d.name)));
        if (excluded(rel)) continue;
        if (d.isDirectory()) walk(join(dir, d.name));
        else walked.push(rel);
      }
    };
    walk(root);
    const records = walked.sort().map((rel) => recordFor(root, rel)).filter(Boolean);
    assertNoCaseCollision(records);
    return { records, git: null, diagnostics, declared: [] };
  }

  const conflicts = splitZ(gitText(root, ['ls-files', '-z', '-u']) ?? '');
  if (conflicts.length) throw new IntentIoError('unresolved-conflict', `the repository has unresolved merge conflicts (${conflicts.length} entr(y|ies)); resolve them before capturing a verification target`);

  const stage = gitText(root, ['ls-files', '--stage', '-z']) ?? '';
  const submodules = splitZ(stage)
    .map((line) => /^160000 [0-9a-f]+ \d\t(.*)$/.exec(line)?.[1])
    .filter(Boolean)
    .map(toSlash);
  const declaredRepos = new Set(declaredInputs.filter((d) => d.kind === 'repository').map((d) => toSlash(d.path)));
  const undeclared = submodules.filter((s) => !declaredRepos.has(s));
  if (undeclared.length) {
    throw new IntentIoError('unsupported-input', `submodule(s) ${undeclared.join(', ')} need an explicit per-repository snapshot; they are never silently omitted from a verification target`);
  }

  const listed = new Set(splitZ(gitText(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']) ?? '').map(toSlash));
  // HEAD's inventory, so a tracked file deleted in the working tree is an explicit deletion
  for (const rel of splitZ(gitText(root, ['ls-tree', '-r', '-z', '--name-only', 'HEAD']) ?? '').map(toSlash)) listed.add(rel);

  const paths = [...listed].filter((rel) => !excluded(rel) && !submodules.includes(rel)).sort();
  const records = paths.map((rel) => recordFor(root, rel)).filter(Boolean);

  // explicitly declared ignored or environment inputs, added on purpose and marked as such
  const declared = [];
  for (const d of declaredInputs.filter((x) => x.kind !== 'repository')) {
    const rel = toSlash(d.path);
    if (excluded(rel)) {
      diagnostics.push({ code: 'declared-input-ignored', message: `${rel} is part of the intent target and is already captured there`, path: rel });
      continue;
    }
    if (!existsSync(join(root, rel))) throw new IntentIoError('missing-declared-input', `the declared verification input ${rel} does not exist`);
    if (!paths.includes(rel)) declared.push(rel);
  }
  for (const rel of declared) records.push({ ...recordFor(root, rel), declared: true });
  records.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  assertNoCaseCollision(records);

  return {
    records,
    // recorded for the reader; the content hash, not this metadata, decides whether two targets match
    git: {
      head: gitText(root, ['rev-parse', 'HEAD'])?.trim() ?? null,
      ref: gitText(root, ['rev-parse', '--abbrev-ref', 'HEAD'])?.trim() ?? null,
      dirty: (gitText(root, ['status', '--porcelain']) ?? '').trim().length > 0,
    },
    diagnostics,
    declared,
  };
}

/** The digest of an inventory: its records only, never its Git metadata. */
export const inventoryDigest = (inventory) => digestOf(inventory.records);

// ---------------------------------------------------------------- acceptance target
/** Requirement-block text with the generated provenance marker removed, and nothing else. */
export const withoutViaMarkers = (text) => lf(text).split('\n').filter((l) => !VIA_LINE_RE.test(l)).join('\n');

const readIf = (p) => (existsSync(p) ? lf(readFileSync(p, 'utf8')) : null);

/**
 * The acceptance target (C-03): the exact contract text a report claims to have satisfied, plus
 * a normalized semantic record of every task.
 *
 * Excluded on purpose, and only this: a task's checkbox state and its `evidence` and `blocked`
 * annotations, plus the manifest's lifecycle stage, revision, timestamps and verification head.
 * Ticking a box or recording an attempt therefore cannot invalidate a report, while changing a
 * task's title, check, dependencies or kind still does.
 */
export function acceptanceTarget(root, dir, rel, { supportingContractPaths = [], overlay = null } = {}) {
  const documents = {};
  const missing = [];
  // an overlay answers reads from candidate text instead of disk, so a digest can be computed
  // for a contract that is proposed but not yet published (C-07)
  const overlaid = (path, text) => (overlay && Object.prototype.hasOwnProperty.call(overlay, path) ? lf(overlay[path]) : text);
  for (const f of ['proposal.md', 'design.md', 'acceptance.md', 'verification-inputs.json', 'spec-base.json']) {
    const text = overlaid(`${rel}/${f}`, readIf(join(dir, f)));
    if (text !== null) documents[`${rel}/${f}`] = text;
  }
  // tasks.md is represented by its semantic record below, never by its raw text: a ticked box
  // and an evidence or blocked annotation are bookkeeping, and must not invalidate a report.
  const tasksText = overlaid(`${rel}/tasks.md`, readIf(join(dir, 'tasks.md')));
  const deltaRoot = join(dir, 'specs');
  if (existsSync(deltaRoot)) {
    for (const cap of readdirSync(deltaRoot).sort()) {
      const text = overlaid(`${rel}/specs/${cap}/spec.md`, readIf(join(deltaRoot, cap, 'spec.md')));
      if (text !== null) documents[`${rel}/specs/${cap}/spec.md`] = withoutViaMarkers(text);
    }
  }
  for (const p of supportingContractPaths) {
    const clean = toSlash(p);
    const text = overlaid(clean, readIf(join(root, clean)));
    if (text === null) {
      missing.push(clean);
      continue;
    }
    documents[clean] = clean.startsWith('specs/') ? withoutViaMarkers(text) : text;
  }
  if (missing.length) throw new IntentIoError('missing-contract-input', `declared supporting contract file(s) not found: ${missing.join(', ')}`);

  // the semantic record: what a task promises, with its bookkeeping deliberately left out
  const parsed = parseTasksMarkdown(tasksText ?? '', { path: `${rel}/tasks.md` });
  const tasks = parsed.tasks.map((t) => ({
    id: t.id,
    number: t.number,
    title: t.title,
    kind: t.kind,
    dependsOn: t.dependsOn,
    accepts: t.accepts,
    design: t.design,
  }));

  const manifest = readManifest(dir);
  const identity = manifest
    ? { id: manifest.id, slug: manifest.slug, kind: manifest.kind, children: manifest.children ?? [], review: manifest.review ?? null }
    : null;
  if (manifest) documents[`${rel}/${MANIFEST_FILE}`] = canonicalJson(identity);

  return { documents, tasks, identity, digest: digestOf({ documents, tasks, identity }) };
}

// ---------------------------------------------------------------- environment
/**
 * The environment a claim depends on. Every fact that cannot be read is the string `unknown`,
 * never a guess and never omitted, so a required unknown blocks the claim that needs it.
 */
export function environmentRecord(root, { declaredTools = [] } = {}) {
  const run = (cmd, args) => {
    const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: GIT_TIMEOUT_MS });
    return r.status === 0 && !r.error ? (r.stdout ?? '').trim().split('\n')[0] : 'unknown';
  };
  const tools = {};
  for (const t of declaredTools) {
    tools[t.name] = t.version ?? (t.command ? run(t.command, t.args ?? ['--version']) : 'unknown');
  }
  return {
    os: `${platform()} ${arch()}`,
    node: process.version,
    git: run('git', ['--version']),
    tools,
  };
}

// ---------------------------------------------------------------- capture and compare
/**
 * One complete verification target. The caller holds the C-09 lock for the capture itself and
 * releases it for the checks; `compareTargets` runs again afterwards under the lock.
 */
export function captureTarget(root, { dir, rel, inputs = {} }) {
  const implementation = implementationInventory(root, {
    declaredInputs: [
      ...(inputs.extraImplementationPaths ?? []).map((p) => ({ kind: 'path', path: p })),
      ...(inputs.repositories ?? []).map((p) => ({ kind: 'repository', path: p })),
    ],
    allowNonGit: inputs.allowNonGit === true,
  });
  const acceptance = acceptanceTarget(root, dir, rel, { supportingContractPaths: inputs.supportingContractPaths ?? [] });
  const environment = environmentRecord(root, { declaredTools: inputs.declaredTools ?? [] });
  const requiredEnvironment = inputs.requiredEnvironment ?? [];
  const unknownRequired = requiredEnvironment.filter((k) => {
    const value = k in environment ? environment[k] : environment.tools[k];
    return value === undefined || value === 'unknown';
  });
  return {
    implementation: { records: implementation.records, git: implementation.git, declared: implementation.declared, digest: inventoryDigest(implementation) },
    acceptance: { documents: acceptance.documents, tasks: acceptance.tasks, identity: acceptance.identity, digest: acceptance.digest },
    environment,
    requiredEnvironment,
    unknownRequired,
    diagnostics: implementation.diagnostics,
  };
}

/**
 * Start-of-run against end-of-run. Anything that moved makes the report describe inputs other
 * than the ones the checks saw, which is INCOMPLETE. The per-record lists say exactly what moved.
 */
export function compareTargets(before, after) {
  const drift = [];
  if (before.implementation.digest !== after.implementation.digest) {
    const byPath = new Map(before.implementation.records.map((r) => [r.path, r]));
    const seen = new Set();
    for (const r of after.implementation.records) {
      seen.add(r.path);
      const was = byPath.get(r.path);
      if (!was) drift.push({ kind: 'source-added', path: r.path });
      else if (was.hash !== r.hash || was.mode !== r.mode) drift.push({ kind: 'source-changed', path: r.path });
    }
    for (const r of before.implementation.records) if (!seen.has(r.path)) drift.push({ kind: 'source-removed', path: r.path });
  }
  if (before.acceptance.digest !== after.acceptance.digest) {
    const keys = new Set([...Object.keys(before.acceptance.documents), ...Object.keys(after.acceptance.documents)]);
    for (const k of [...keys].sort()) {
      if (before.acceptance.documents[k] !== after.acceptance.documents[k]) drift.push({ kind: 'contract-changed', path: k });
    }
    if (canonicalJson(before.acceptance.tasks) !== canonicalJson(after.acceptance.tasks)) drift.push({ kind: 'task-contract-changed', path: 'tasks.md' });
    if (canonicalJson(before.acceptance.identity) !== canonicalJson(after.acceptance.identity)) drift.push({ kind: 'identity-changed', path: MANIFEST_FILE });
  }
  for (const key of before.requiredEnvironment) {
    const a = key in before.environment ? before.environment[key] : before.environment.tools[key];
    const b = key in after.environment ? after.environment[key] : after.environment.tools[key];
    if (a !== b) drift.push({ kind: 'environment-changed', path: key });
  }
  return { drift, clean: drift.length === 0 };
}

// ---------------------------------------------------------------- immutable attempts (C-04)
export const VERDICTS = ['PASS', 'FAIL', 'INCOMPLETE'];
export const CRITERION_STATUSES = ['VERIFIED', 'PARTIAL', 'MISSING', 'CONTRADICTED'];
export const ORIGIN_KINDS = ['native-agent', 'imported', 'unattested'];
export const HEAD_STATES = ['reserved', 'open', 'closed'];
const ATTEMPT_RE = /^V-(\d+)$/;
const REPORT_VERDICT_RE = /^#{1,6}\s*Verdict:\s*(PASS|FAIL|INCOMPLETE)\s*$/im;

export const attemptName = (sequence) => `V-${sequence}`;
export const attemptDir = (changeDir, sequence) => join(changeDir, 'verify', attemptName(sequence));
export const parseAttemptName = (name) => {
  const m = ATTEMPT_RE.exec(String(name ?? ''));
  return m ? Number(m[1]) : null;
};

const writeManifestHead = (dir, patch) => {
  const manifest = readManifest(dir);
  if (!manifest) throw new IntentIoError('no-identity', `${dir} has no ${MANIFEST_FILE}; a verification attempt needs a stable identity`);
  const next = { ...manifest, verification: { ...manifest.verification, ...patch } };
  writeFileAtomic(join(dir, MANIFEST_FILE), JSON.stringify(next, null, 2) + '\n');
  return next;
};

/**
 * The verdict the recorded criteria actually support, and every reason it is not PASS.
 * A required criterion that is PARTIAL or MISSING means INCOMPLETE; behaviour that was
 * contradicted means FAIL. No criterion is ever softened to make a verdict reachable.
 */
export function evaluateResult(result, requiredCriteria) {
  const problems = [];
  const byId = new Map((result.criteria ?? []).map((c) => [c.id, c]));
  let missing = false;
  let contradicted = false;
  for (const required of requiredCriteria) {
    const got = byId.get(required.id);
    if (!got) {
      problems.push(`required criterion ${required.id} is not in the result`);
      missing = true;
      continue;
    }
    if (!CRITERION_STATUSES.includes(got.status)) {
      problems.push(`criterion ${required.id} has an unknown status ${JSON.stringify(got.status)}`);
      missing = true;
      continue;
    }
    if (got.status === 'CONTRADICTED') {
      problems.push(`criterion ${required.id} was contradicted by the checks`);
      contradicted = true;
      continue;
    }
    if (got.status !== 'VERIFIED') {
      problems.push(`required criterion ${required.id} is ${got.status}`);
      missing = true;
      continue;
    }
    const covered = new Set(got.modes ?? []);
    const uncovered = (required.modes ?? []).filter((m) => !covered.has(m));
    if (uncovered.length) {
      problems.push(`criterion ${required.id} declares evidence mode(s) ${uncovered.join(', ')} that this attempt did not cover`);
      missing = true;
    }
    if (!(got.evidenceRefs ?? []).length) {
      problems.push(`criterion ${required.id} is VERIFIED but names no evidence`);
      missing = true;
    }
  }
  const verdict = contradicted ? 'FAIL' : missing ? 'INCOMPLETE' : 'PASS';
  return { verdict, problems };
}

/**
 * Whether a recorded origin qualifies as independent verification. This is a procedural
 * attestation by a trusted local operator, not proof against a hostile one: an imported or
 * unattested report stays visibly unqualified, and a verifier that is also the writer never
 * qualifies, however the report is worded.
 */
export function qualifiedOrigin(origin) {
  const reasons = [];
  if (!origin || !ORIGIN_KINDS.includes(origin.kind)) return { qualified: false, reasons: ['the result records no recognised origin'] };
  if (origin.kind !== 'native-agent') reasons.push(`origin kind "${origin.kind}" is unattested history, not an independent pass`);
  if (!origin.actorId) reasons.push('the verifying actor is not identified');
  if (!origin.writerActorId) reasons.push('the writing actor is not identified');
  if (origin.actorId && origin.actorId === origin.writerActorId) reasons.push('the verifier and the writer are the same actor');
  if (!origin.sourceRef) reasons.push('no source reference attests where the report came from');
  return { qualified: reasons.length === 0, reasons };
}

/**
 * Reserve the next attempt, then publish its directory. The order matters: the durable
 * high-water mark and head move first, so a crash anywhere afterwards leaves a head that is not
 * closed, which blocks an older PASS instead of quietly falling back to it.
 */
export function beginAttempt(root, { dir, rel, inputs = {}, requiredCriteria = [], session = null, actorId = null }, token) {
  if (!holdsLock(root, token)) throw new IntentIoError('lock-lost', 'evidence begin requires the live intent lock token');
  const manifest = readManifest(dir);
  if (!manifest) throw new IntentIoError('no-identity', `${rel} has no ${MANIFEST_FILE}; upgrade the change before recording verification`);

  // a pending amendment means the contract is mid-revision; final evidence waits for it (C-07)
  const pendingAmendment = amendmentState(dir).pending;
  if (pendingAmendment) throw new IntentIoError('amendment-pending', `${rel} has a pending amendment (${pendingAmendment.id}); apply or cancel it before starting a verification attempt`);

  // an attempt claims a contract is satisfied, so the contract has to be one that can be (C-01)
  const notExecutable = executableContractProblems(dir, rel);
  if (notExecutable.length) {
    throw new IntentIoError('invalid-contract', `${rel} is not an executable contract: ${notExecutable.map((p) => p.message).join('; ')}`, { problems: notExecutable });
  }

  // a declared lane is a promise about how much review this contract had; evidence recorded
  // against an unapproved contract would attest to something nobody approved (C-07)
  const approval = contractApproval(root, { dir, rel, inputs });
  if (approval.declared && !approval.approved) {
    throw new IntentIoError('unapproved-contract', `${rel} declares the ${approval.lane} review lane, and this contract is not approved for it: ${approval.reasons.join('; ')}`, { approval });
  }

  // the reviewed input scope, when the change declares one, is the only scope an attempt may use
  const declaredPath = join(dir, 'verification-inputs.json');
  if (existsSync(declaredPath)) {
    const declared = JSON.parse(readFileSync(declaredPath, 'utf8'));
    if (digestOf(normalizeInputs(declared)) !== digestOf(normalizeInputs(inputs))) {
      throw new IntentIoError('input-scope-mismatch', `the supplied --inputs do not match the reviewed ${rel}/verification-inputs.json; a different scope needs a reviewed revision`);
    }
  }

  const target = captureTarget(root, { dir, rel, inputs });
  if (target.unknownRequired.length) {
    throw new IntentIoError('unknown-required-environment', `required environment input(s) could not be read: ${target.unknownRequired.join(', ')}; a claim that depends on them cannot start`);
  }

  const sequence = (manifest.verification?.highWater ?? 0) + 1;
  const started = new Date().toISOString();
  // 1. durable reservation, before anything exists on disk to be found later
  writeManifestHead(dir, { highWater: sequence, head: { sequence, state: 'reserved', requestDigest: null, resultDigest: null, verdict: null, started, finished: null } });

  // 2. stage the attempt beside its destination, then publish it by rename
  const finalDir = attemptDir(dir, sequence);
  const stagingDir = `${finalDir}.staging-${process.pid.toString(36)}`;
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(join(stagingDir, 'contract'), { recursive: true });
  const request = {
    schemaVersion: 2,
    changeId: manifest.id,
    sequence,
    started,
    inputs: normalizeInputs(inputs),
    implementationDigest: target.implementation.digest,
    acceptanceDigest: target.acceptance.digest,
    environment: target.environment,
    requiredEnvironment: target.requiredEnvironment,
    requiredCriteria: requiredCriteria.map((c) => ({ id: c.id, modes: c.modes ?? [] })),
    session,
    actorId,
  };
  writeFileAtomic(join(stagingDir, 'request.json'), JSON.stringify(request, null, 2) + '\n');
  // the contract text as it was, so a link into this attempt shows what the report actually claimed
  const contractFiles = {};
  for (const [path, text] of Object.entries(target.acceptance.documents)) {
    contractFiles[path] = contractFileName(path);
    writeFileAtomic(join(stagingDir, 'contract', contractFiles[path]), text);
  }
  writeFileAtomic(
    join(stagingDir, 'target.json'),
    JSON.stringify(
      { implementation: target.implementation, acceptance: { digest: target.acceptance.digest, tasks: target.acceptance.tasks, identity: target.acceptance.identity }, environment: target.environment, contractFiles },
      null,
      2
    ) + '\n'
  );
  mkdirSync(dirname(finalDir), { recursive: true });
  renameSync(stagingDir, finalDir);

  // 3. only now is the attempt open; the head records the exact request it was opened for
  const requestDigest = digestOf(request);
  writeManifestHead(dir, { head: { sequence, state: 'open', requestDigest, resultDigest: null, verdict: null, started, finished: null } });
  return { sequence, dir: finalDir, request, requestDigest, target };
}

/** The declared input scope, in one canonical shape, so two spellings of it compare equal. */
export function normalizeInputs(inputs = {}) {
  const list = (v) => [...new Set((v ?? []).map((x) => String(x).replace(/\\/g, '/')))].sort();
  return {
    supportingContractPaths: list(inputs.supportingContractPaths),
    extraImplementationPaths: list(inputs.extraImplementationPaths),
    repositories: list(inputs.repositories),
    requiredEnvironment: list(inputs.requiredEnvironment),
    declaredTools: (inputs.declaredTools ?? []).map((t) => ({ name: t.name, command: t.command ?? null, args: t.args ?? null, version: t.version ?? null })).sort((a, b) => (a.name < b.name ? -1 : 1)),
    allowNonGit: inputs.allowNonGit === true,
  };
}

/**
 * Record one attempt's verbatim report and structured result, then close the head. Both files
 * are immutable: a second record for the same attempt is refused rather than overwriting the
 * first. A crash before the head is closed leaves the attempt incomplete, never PASS.
 */
export function recordAttempt(root, { dir, rel, sequence, result, reportText, artifacts = [], requiredCriteria = [] }, token) {
  if (!holdsLock(root, token)) throw new IntentIoError('lock-lost', 'evidence record requires the live intent lock token');
  const manifest = readManifest(dir);
  const head = manifest?.verification?.head ?? null;
  if (!head || head.sequence !== sequence) throw new IntentIoError('head-mismatch', `${rel} has no open attempt ${attemptName(sequence)}; the durable head is ${head ? `${attemptName(head.sequence)} (${head.state})` : 'absent'}`);
  if (head.state === 'closed') throw new IntentIoError('attempt-closed', `${attemptName(sequence)} is already closed; an attempt is immutable`);
  const aDir = attemptDir(dir, sequence);
  if (!existsSync(join(aDir, 'request.json'))) throw new IntentIoError('missing-attempt', `${rel}/verify/${attemptName(sequence)}/request.json is missing; this attempt cannot be recorded, only cancelled`);
  if (existsSync(join(aDir, 'result.json'))) throw new IntentIoError('attempt-closed', `${attemptName(sequence)} already has a result; an attempt is immutable`);

  const request = JSON.parse(readFileSync(join(aDir, 'request.json'), 'utf8'));
  const required = requiredCriteria.length ? requiredCriteria : request.requiredCriteria ?? [];
  const evaluated = evaluateResult(result, required);
  // Required coverage is a severity floor (PASS < INCOMPLETE < FAIL), not an instruction
  // to approve: the verifier can withhold completion for mandatory design constraints.
  // Extra observations do not automatically become required acceptance criteria.
  if (!VERDICTS.includes(result.verdict)
      || (evaluated.verdict === 'FAIL' && result.verdict !== 'FAIL')
      || (evaluated.verdict === 'INCOMPLETE' && result.verdict === 'PASS')) {
    throw new IntentIoError('verdict-mismatch', `required criteria support at least ${evaluated.verdict}; overall ${result.verdict} is not allowed: ${evaluated.problems.join('; ')}`);
  }
  const reportVerdict = REPORT_VERDICT_RE.exec(reportText ?? '')?.[1] ?? null;
  if (reportVerdict !== result.verdict) {
    throw new IntentIoError('report-verdict-mismatch', `the report header says ${reportVerdict ?? 'nothing'} while the result says ${result.verdict}`);
  }
  const origin = qualifiedOrigin(result.origin);
  if (result.verdict === 'PASS' && !origin.qualified) {
    throw new IntentIoError('unqualified-origin', `a PASS needs independent provenance: ${origin.reasons.join('; ')}`);
  }

  // copied artifacts live inside the attempt; their original locations are never served
  const copied = [];
  for (const a of artifacts) {
    const relative_ = String(a.relativePath ?? '').replace(/\\/g, '/');
    if (!relative_ || relative_.startsWith('/') || relative_.split('/').includes('..')) throw new IntentIoError('bad-artifact-path', `artifact destination ${JSON.stringify(a.relativePath)} must be a plain relative path inside artifacts/`);
    const source = resolve(root, a.sourcePath);
    if (!existsSync(source)) throw new IntentIoError('missing-artifact', `artifact source ${a.sourcePath} does not exist`);
    const bytes = readFileSync(source);
    writeFileAtomic(join(aDir, 'artifacts', relative_), bytes);
    copied.push({ relativePath: relative_, hash: sha256Hex(bytes), bytes: bytes.length });
  }

  const reportHash = sha256Hex(lf(reportText));
  const record = {
    schemaVersion: 2,
    changeId: request.changeId,
    sequence,
    requestDigest: digestOf(request),
    verdict: result.verdict,
    criteria: result.criteria ?? [],
    commands: result.commands ?? [],
    origin: result.origin ?? null,
    qualified: origin.qualified,
    originProblems: origin.reasons,
    endImplementationDigest: result.endImplementationDigest ?? null,
    endAcceptanceDigest: result.endAcceptanceDigest ?? null,
    artifacts: copied,
    reportHash,
    finished: new Date().toISOString(),
  };
  writeFileAtomic(join(aDir, 'report.md'), lf(reportText));
  writeFileAtomic(join(aDir, 'result.json'), JSON.stringify(record, null, 2) + '\n');
  writeManifestHead(dir, { head: { sequence, state: 'closed', requestDigest: record.requestDigest, resultDigest: digestOf(record), verdict: record.verdict, started: head.started, finished: record.finished } });
  return record;
}

/**
 * Close a reserved or open attempt that cannot be recorded, including one whose directory never
 * appeared. It writes an INCOMPLETE cancellation and closes that same head. It never lowers the
 * high-water mark and never restores an older PASS.
 */
export function cancelAttempt(root, { dir, rel, sequence, reason }, token) {
  if (!holdsLock(root, token)) throw new IntentIoError('lock-lost', 'evidence cancel requires the live intent lock token');
  const manifest = readManifest(dir);
  const head = manifest?.verification?.head ?? null;
  if (!head || head.sequence !== sequence) throw new IntentIoError('head-mismatch', `${rel} has no attempt ${attemptName(sequence)} at its head`);
  if (head.state === 'closed') throw new IntentIoError('attempt-closed', `${attemptName(sequence)} is already closed`);
  const record = {
    schemaVersion: 2,
    changeId: manifest.id,
    sequence,
    requestDigest: head.requestDigest,
    verdict: 'INCOMPLETE',
    cancelled: { reason: reason ?? 'cancelled', at: new Date().toISOString() },
    criteria: [],
    commands: [],
    origin: null,
    qualified: false,
    originProblems: ['a cancelled attempt has no verification provenance'],
    artifacts: [],
    reportHash: null,
    finished: new Date().toISOString(),
  };
  mkdirSync(attemptDir(dir, sequence), { recursive: true });
  writeFileAtomic(join(attemptDir(dir, sequence), 'result.json'), JSON.stringify(record, null, 2) + '\n');
  writeManifestHead(dir, { head: { sequence, state: 'closed', requestDigest: head.requestDigest, resultDigest: digestOf(record), verdict: 'INCOMPLETE', started: head.started, finished: record.finished } });
  return record;
}

/**
 * What the durable head says, and whether it is a verified closeout. The head is authoritative:
 * a reserved or open head, an absent directory or result, a digest that does not match, or a
 * verdict other than PASS all block archive. Older attempts are never scanned for a PASS.
 */
export function evidenceStatus(root, { dir, rel }) {
  const manifest = readManifest(dir);
  if (!manifest) return { schemaVersion: 1, highWater: 0, head: null, eligible: false, reasons: [`${rel} has no ${MANIFEST_FILE}; legacy changes carry no verification head`], corrupt: false };
  const v = manifest.verification;
  if (!v || typeof v.highWater !== 'number') {
    return { schemaVersion: 2, highWater: null, head: null, eligible: false, corrupt: true, reasons: ['the verification metadata is missing or corrupt; it is never repaired by scanning for an older PASS'] };
  }
  const head = v.head ?? null;
  const reasons = [];
  if (!head) reasons.push('no verification attempt has been started');
  else if (head.sequence > v.highWater) return { schemaVersion: 2, highWater: v.highWater, head, eligible: false, corrupt: true, reasons: [`the head names ${attemptName(head.sequence)}, beyond the high-water mark ${v.highWater}`] };
  else if (head.state !== 'closed') reasons.push(`${attemptName(head.sequence)} is ${head.state}; an unfinished attempt blocks an older PASS`);

  let result = null;
  if (head) {
    const p = join(attemptDir(dir, head.sequence), 'result.json');
    if (!existsSync(p)) reasons.push(`${rel}/verify/${attemptName(head.sequence)}/result.json is absent`);
    else {
      try {
        result = JSON.parse(readFileSync(p, 'utf8'));
      } catch (e) {
        reasons.push(`${rel}/verify/${attemptName(head.sequence)}/result.json is not readable JSON: ${e.message}`);
      }
      if (result && head.resultDigest && digestOf(result) !== head.resultDigest) reasons.push(`the recorded result of ${attemptName(head.sequence)} does not match the digest in the head`);
      if (result && result.verdict !== 'PASS') reasons.push(`${attemptName(head.sequence)} is ${result.verdict}`);
      if (result && result.verdict === 'PASS' && !result.qualified) reasons.push(`${attemptName(head.sequence)} has no independent provenance: ${(result.originProblems ?? []).join('; ')}`);
      if (result && result.reportHash) {
        const reportPath = join(attemptDir(dir, head.sequence), 'report.md');
        if (!existsSync(reportPath)) reasons.push(`the verbatim report of ${attemptName(head.sequence)} is missing`);
        else if (sha256Hex(lf(readFileSync(reportPath, 'utf8'))) !== result.reportHash) reasons.push(`the verbatim report of ${attemptName(head.sequence)} does not match its recorded hash`);
      }
    }
  }
  // older numbered attempts that vanished are diagnosed, but never consulted for a verdict
  const missingOlder = [];
  for (let i = 1; i < (head?.sequence ?? v.highWater + 1); i++) {
    if (!existsSync(attemptDir(dir, i))) missingOlder.push(attemptName(i));
  }
  return {
    schemaVersion: 2,
    highWater: v.highWater,
    head,
    result,
    eligible: reasons.length === 0 && result?.verdict === 'PASS',
    corrupt: false,
    reasons,
    missingOlder,
  };
}

/** One stored contract file per document path; `/` is not a directory here, it is part of a name. */
export const contractFileName = (path) => path.replace(/[\\/]/g, '__');

/**
 * One attempt as a readable projection: what it was opened against, what it found, and what it
 * copied. It is served from the attempt's own immutable files, so it keeps saying the same thing
 * after the change is archived and after the contract has moved on.
 */
export function attemptProjection(dir, rel, sequence) {
  const aDir = attemptDir(dir, sequence);
  const read = (name) => {
    const p = join(aDir, name);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, 'utf8'));
    } catch {
      return { unreadable: true };
    }
  };
  const request = read('request.json');
  const result = read('result.json');
  const target = read('target.json');
  if (!request && !result) return null;
  const reportPath = join(aDir, 'report.md');
  return {
    id: attemptName(sequence),
    sequence,
    path: `${rel}/verify/${attemptName(sequence)}`,
    started: request?.started ?? null,
    finished: result?.finished ?? null,
    verdict: result?.verdict ?? null,
    cancelled: result?.cancelled ?? null,
    qualified: result?.qualified ?? false,
    originProblems: result?.originProblems ?? [],
    origin: result?.origin ?? null,
    criteria: result?.criteria ?? [],
    commands: result?.commands ?? [],
    artifacts: result?.artifacts ?? [],
    requiredCriteria: request?.requiredCriteria ?? [],
    implementationDigest: request?.implementationDigest ?? null,
    acceptanceDigest: request?.acceptanceDigest ?? null,
    environment: request?.environment ?? null,
    requiredEnvironment: request?.requiredEnvironment ?? [],
    session: request?.session ?? null,
    hasReport: existsSync(reportPath),
    capturedContract: Object.keys(target?.contractFiles ?? {}).sort(),
    incomplete: !result,
  };
}

/** Every attempt this change has on disk, newest first, whatever the head says about them. */
export function attemptList(dir, rel) {
  const verifyDir = join(dir, 'verify');
  if (!existsSync(verifyDir)) return [];
  return readdirSync(verifyDir)
    .map(parseAttemptName)
    .filter((n) => n !== null)
    .sort((a, b) => b - a)
    .map((n) => attemptProjection(dir, rel, n))
    .filter(Boolean);
}

/**
 * The acceptance text exactly as this attempt captured it. A link to
 * `.../evidence/V-2/acceptance/AC-01` therefore shows what the report claimed, not what the
 * criterion says today, and the two can be compared without either being rewritten.
 */
export function capturedAcceptance(dir, sequence, acceptanceId) {
  const aDir = attemptDir(dir, sequence);
  const targetPath = join(aDir, 'target.json');
  if (!existsSync(targetPath)) return null;
  let contractFiles;
  try {
    contractFiles = JSON.parse(readFileSync(targetPath, 'utf8')).contractFiles ?? {};
  } catch {
    return null;
  }
  const entry = Object.entries(contractFiles).find(([path]) => path.endsWith('/acceptance.md'));
  if (!entry) return null;
  const file = join(aDir, 'contract', entry[1]);
  if (!existsSync(file)) return null;
  const parsed = parseAcceptanceMarkdown(readFileSync(file, 'utf8'), { path: entry[0] });
  const criterion = parsed.byId.get(acceptanceId);
  if (!criterion) return null;
  const lines = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
  return {
    id: criterion.id,
    title: criterion.title,
    required: criterion.required,
    evidenceModes: criterion.evidenceModes,
    checks: criterion.checks,
    requirements: criterion.requirements,
    capturedFrom: entry[0],
    text: lines.slice(criterion.line - 1, criterion.endLine).join('\n').trimEnd(),
  };
}

// ---------------------------------------------------------------- reviews and amendments (C-07)
export const AMENDMENT_TYPES = ['locator', 'equivalent-check', 'scope'];
export const AMENDMENT_STATES = ['pending', 'applied', 'cancelled'];
export const REVIEW_ROLES = ['planner', 'architect', 'critic', 'verifier', 'user'];
const HOLD_RE = /;?\s*amendment A-[A-Za-z0-9-]+ pending/g;

const reviewsDir = (dir) => join(dir, 'reviews');
const amendmentsDir = (dir) => join(dir, 'amendments');
const readJsonIf = (p) => {
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return { unreadable: true };
  }
};

/**
 * The input scope a change declares for itself. It is the only scope `evidence begin` accepts,
 * so it is also the scope every other reader must use: a change whose contract reaches beyond
 * its own directory has one digest, not one per caller.
 */
export function declaredScope(dir) {
  const p = join(dir, 'verification-inputs.json');
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    // an unreadable declaration is itself part of the acceptance target, so the digest still
    // moves; `evidence begin` is where it is refused outright
    return {};
  }
}

/**
 * The digest of the contract as it stands right now: what a review or an amendment refers to.
 * With no explicit `supportingContractPaths`, the change's own declared scope is used, so every
 * caller sees the same contract.
 */
export function currentContractDigest(root, dir, rel, inputs = null, overlay = null) {
  const scope = inputs?.supportingContractPaths ? inputs : declaredScope(dir);
  return acceptanceTarget(root, dir, rel, { supportingContractPaths: scope.supportingContractPaths ?? [], overlay }).digest;
}

/**
 * One immutable review record, with the exact contract text it reviewed stored beside it. A
 * review is a procedural attestation: it records who said what about which digest. It does not
 * prove the reviewer was independent, and the record says so by naming both actors.
 */
export function recordReview(root, { dir, rel, review, contractText = null }, token) {
  if (!holdsLock(root, token)) throw new IntentIoError('lock-lost', 'review record requires the live intent lock token');
  const id = String(review?.id ?? '').trim();
  if (!/^R-[A-Za-z0-9-]+$/.test(id)) throw new IntentIoError('bad-review', 'a review needs an id like R-1');
  if (!REVIEW_ROLES.includes(review?.role)) throw new IntentIoError('bad-review', `role must be one of ${REVIEW_ROLES.join(', ')}`);
  if (typeof review?.verdict !== 'string' || !review.verdict.trim()) throw new IntentIoError('bad-review', 'a review needs a verdict');
  if (typeof review?.contractDigest !== 'string' || !/^[0-9a-f]{64}$/.test(review.contractDigest)) throw new IntentIoError('bad-review', 'a review must name the exact contract digest it reviewed');
  const target = join(reviewsDir(dir), id);
  if (existsSync(join(target, 'review.json'))) throw new IntentIoError('review-exists', `${rel}/reviews/${id}/review.json already exists; a review is immutable`);
  const record = {
    schemaVersion: 2,
    id,
    changeId: readManifest(dir)?.id ?? null,
    contractDigest: review.contractDigest,
    amendment: review.amendment ?? null,
    role: review.role,
    actorId: review.actorId ?? null,
    writerActorId: review.writerActorId ?? null,
    verdict: review.verdict,
    sourceRef: review.sourceRef ?? null,
    findings: review.findings ?? [],
    independent: !!review.actorId && !!review.writerActorId && review.actorId !== review.writerActorId,
    reviewedAt: new Date().toISOString(),
  };
  writeFileAtomic(join(target, 'review.json'), JSON.stringify(record, null, 2) + '\n');
  if (contractText !== null) writeFileAtomic(join(target, 'contract', 'contract.md'), lf(contractText));
  return record;
}

/** Every recorded review, oldest first. Reviews are history; they are never rewritten. */
export function listReviews(dir) {
  const d = reviewsDir(dir);
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .sort()
    .map((id) => readJsonIf(join(d, id, 'review.json')))
    .filter((r) => r && !r.unreadable);
}

/**
 * Which tasks an amendment touches: the ids it changes, plus everything that depends on them,
 * under both the old and the new dependency declarations. A reviewer may widen this set; nothing
 * narrows it silently.
 */
export function affectedTasks(intent, changedTaskIds, candidateTasksText = null) {
  const affected = new Set(changedTaskIds ?? []);
  const collect = (tasks) => {
    const dependents = new Map();
    for (const t of tasks) {
      for (const dep of t.dependsOn ?? []) {
        if (!dependents.has(dep)) dependents.set(dep, []);
        dependents.get(dep).push(t.id);
      }
    }
    const queue = [...affected];
    while (queue.length) {
      const id = queue.shift();
      for (const next of dependents.get(id) ?? []) {
        if (affected.has(next)) continue;
        affected.add(next);
        queue.push(next);
      }
    }
  };
  collect(intent.tasks.tasks);
  if (candidateTasksText) collect(parseTasksMarkdown(candidateTasksText).tasks);
  return affected;
}

/**
 * Rewrites `tasks.md` so the affected tasks are visibly held: a ticked box is reopened and the
 * hold is appended to whatever blocker text the task already had, because two `blocked:` fields
 * on one task would be a parse error and because an earlier blocker is not this amendment's to
 * erase. Returns the new text; the caller publishes it inside the transaction.
 */
export function applyHold(tasksText, affected, amendmentId) {
  const parsed = parseTasksMarkdown(tasksText);
  const lines = lf(tasksText).split('\n');
  const hold = `amendment ${amendmentId} pending`;
  for (const task of parsed.tasks) {
    if (!task.id || !affected.has(task.id)) continue;
    const i = task.line - 1;
    lines[i] = lines[i].replace(/^(\s*- )\[[xX]\]/, '$1[ ]');
    const blockedLine = lines.slice(task.line, task.endLine).findIndex((l) => /^\s+- blocked:/.test(l));
    if (blockedLine >= 0) {
      const at = task.line + blockedLine;
      if (!lines[at].includes(hold)) lines[at] = `${lines[at].replace(/\s+$/, '')}; ${hold}`;
      continue;
    }
    const indent = /^(\s*)- \[/.exec(lines[i])[1];
    lines.splice(task.endLine, 0, `${indent}  - blocked: ${hold}`);
    // every later task moved down by one line; re-parse rather than track offsets
    return applyHold(lines.join('\n'), affected, amendmentId);
  }
  return lines.join('\n');
}

/** Removes only this amendment's hold, leaving any earlier blocker text exactly as it was. */
export function removeHold(tasksText, amendmentId) {
  const hold = new RegExp(`;?\\s*amendment ${amendmentId} pending`);
  return lf(tasksText)
    .split('\n')
    .flatMap((line) => {
      if (!/^\s+- blocked:/.test(line) || !hold.test(line)) return [line];
      const stripped = line.replace(hold, '').replace(/\s+$/, '');
      return /^\s+- blocked:\s*$/.test(stripped) ? [] : [stripped];
    })
    .join('\n');
}

/** Reopens every affected task and drops its now-invalid evidence links. */
export function reopenTasks(tasksText, affected) {
  const parsed = parseTasksMarkdown(tasksText);
  const lines = lf(tasksText).split('\n');
  const drop = new Set();
  for (const task of parsed.tasks) {
    if (!task.id || !affected.has(task.id)) continue;
    lines[task.line - 1] = lines[task.line - 1].replace(/^(\s*- )\[[xX]\]/, '$1[ ]');
    for (let i = task.line; i < task.endLine; i++) if (/^\s+- evidence:/.test(lines[i])) drop.add(i);
  }
  return lines.filter((_, i) => !drop.has(i)).join('\n');
}

/** The amendments this change has, and the at-most-one that is pending. */
export function amendmentState(dir) {
  const d = amendmentsDir(dir);
  if (!existsSync(d)) return { all: [], pending: null };
  const all = readdirSync(d)
    .sort()
    .map((id) => {
      const state = readJsonIf(join(d, id, 'state.json'));
      const candidate = readJsonIf(join(d, id, 'candidate.json'));
      return { id, state: state?.state ?? 'unreadable', appliedAt: state?.appliedAt ?? null, oldDigest: state?.oldDigest ?? null, newDigest: state?.newDigest ?? null, candidate: candidate?.unreadable ? null : candidate };
    });
  return { all, pending: all.find((a) => a.state === 'pending') ?? null };
}

/**
 * Stage an amendment. Nothing about the live contract changes: the candidate text is written
 * beside it, the approved text stays in force for every unaffected task, and the affected tasks
 * are visibly held. That is what lets the rest of the plan keep running during a review.
 */
export function proposeAmendment(root, { dir, rel, candidate, inputs = {} }, token) {
  if (!holdsLock(root, token)) throw new IntentIoError('lock-lost', 'amend propose requires the live intent lock token');
  const id = String(candidate?.id ?? '').trim();
  if (!/^A-[A-Za-z0-9-]+$/.test(id)) throw new IntentIoError('bad-amendment', 'an amendment needs an id like A-1');
  if (!AMENDMENT_TYPES.includes(candidate?.type)) throw new IntentIoError('bad-amendment', `type must be one of ${AMENDMENT_TYPES.join(', ')}`);
  if (typeof candidate?.cause !== 'string' || !candidate.cause.trim()) throw new IntentIoError('bad-amendment', 'an amendment needs a cause');
  const existing = amendmentState(dir);
  if (existing.pending) throw new IntentIoError('amendment-pending', `${rel} already has a pending amendment (${existing.pending.id}); apply or cancel it first`);
  if (existing.all.some((a) => a.id === id)) throw new IntentIoError('amendment-exists', `${rel}/amendments/${id} already exists; amendment history is immutable`);

  const oldDigest = currentContractDigest(root, dir, rel, inputs);
  if (candidate.oldDigest && candidate.oldDigest !== oldDigest) {
    throw new IntentIoError('stale-candidate', `this amendment was written against contract ${candidate.oldDigest.slice(0, 12)}, but the approved contract is now ${oldDigest.slice(0, 12)}`);
  }
  const files = candidate.files ?? {};
  for (const path of Object.keys(files)) {
    if (!path.startsWith(`${rel}/`)) throw new IntentIoError('bad-amendment', `${path} is outside ${rel}; an amendment changes this change's own contract`);
    // the manifest carries the risk lane and the identity; changing either is a new contract
    // that needs its own full review, never a link an approval can be inherited through
    if (path === `${rel}/${MANIFEST_FILE}`) throw new IntentIoError('bad-amendment', `${path} is the change manifest; a risk lane or identity change needs fresh review of the new contract, not an amendment`);
  }
  const intent = readChangeIntentDir(dir, rel.split('/').pop(), { rel });
  const affected = affectedTasks(intent, candidate.changed?.tasks ?? [], files[`${rel}/tasks.md`] ?? null);
  // an acceptance or design id that changed affects every task that points at it
  const changedRefs = new Set([...(candidate.changed?.acceptance ?? []), ...(candidate.changed?.design ?? [])]);
  if (changedRefs.size) {
    for (const node of intent.graph.nodes.values()) {
      if ((node.task.accepts ?? []).some((a) => changedRefs.has(a)) || (node.task.design ?? []).some((d) => changedRefs.has(d))) affected.add(node.id);
    }
    for (const id_ of [...affected]) affectedTasks(intent, [id_]).forEach((x) => affected.add(x));
  }
  const record = {
    schemaVersion: 2,
    id,
    changeId: readManifest(dir)?.id ?? null,
    type: candidate.type,
    cause: candidate.cause,
    findingId: candidate.findingId ?? null,
    oldDigest,
    // the exact digest publishing this candidate will produce, so an approval chain can bind
    // this link to the next without recomputing it from text that has since moved (C-07)
    candidateDigest: currentContractDigest(root, dir, rel, inputs, files),
    changed: { tasks: candidate.changed?.tasks ?? [], acceptance: candidate.changed?.acceptance ?? [], design: candidate.changed?.design ?? [] },
    affected: [...affected].sort(),
    files: Object.keys(files).sort(),
    proposedAt: new Date().toISOString(),
    authority: candidate.authority ?? null,
  };
  const steps = [
    { kind: 'file', path: `${rel}/amendments/${id}/candidate.json`, content: JSON.stringify(record, null, 2) + '\n' },
    { kind: 'file', path: `${rel}/amendments/${id}/state.json`, content: JSON.stringify({ state: 'pending', proposedAt: record.proposedAt }, null, 2) + '\n' },
  ];
  // the old and the candidate text, both kept, so the pair can be read later without a diff tool
  for (const [path, text] of Object.entries(files)) {
    const name = path.slice(rel.length + 1).replace(/[\\/]/g, '__');
    const current = existsSync(join(root, path)) ? lf(readFileSync(join(root, path), 'utf8')) : '';
    steps.push({ kind: 'file', path: `${rel}/amendments/${id}/old/${name}`, content: current });
    steps.push({ kind: 'file', path: `${rel}/amendments/${id}/candidate/${name}`, content: lf(text) });
  }
  // and the hold, in tasks.md, which stays the only ledger
  const tasksText = lf(readFileSync(join(dir, 'tasks.md'), 'utf8'));
  const held = applyHold(tasksText, affected, id);
  if (held !== tasksText) steps.push({ kind: 'file', path: `${rel}/tasks.md`, content: held });
  return { record, steps };
}

/** The authority an amendment of this type needs before it may be applied. */
/**
 * `lane` is the risk lane the change records. A scope amendment is the one type that can reduce
 * a guarantee or widen a commitment, so it is held to that lane, not to any one reviewer who
 * happened to say OKAY.
 */
export function amendmentAuthority(record, reviews, lane = null) {
  const candidateDigest = record.candidateDigest ?? null;
  const forThis = reviews.filter((r) => r.amendment === record.id);
  if (record.type === 'locator') {
    const ok = record.authority?.kind === 'executor-locator' && record.authority?.actorId;
    return { ok: !!ok, reasons: ok ? [] : ['a locator correction needs recorded executor authority (authority.kind "executor-locator" with an actorId)'] };
  }
  if (record.type === 'equivalent-check') {
    const review = forThis.find((r) => r.role === 'critic' && /^(OKAY|OK|APPROVE[D]?)$/i.test(r.verdict) && r.independent);
    return { ok: !!review, reasons: review ? [] : ['an equivalent-check amendment needs an independent critic review of the candidate with verdict OKAY'] };
  }
  const scoped = record.authority?.kind === 'user-scope' && record.authority?.sourceRef;
  const reasons = [];
  if (!scoped) reasons.push('a scope amendment needs explicit user scope authority (authority.kind "user-scope" with a sourceRef)');
  if (lane) {
    const lanes = laneApproval(lane, reviews, candidateDigest, { amendment: record.id, rationale: record.cause });
    if (!lanes.approved) reasons.push(`a scope amendment needs the ${lane} lane's review of the candidate: ${lanes.reasons.join('; ')}`);
  } else {
    const review = forThis.find((r) => /^(OKAY|OK|APPROVE[D]?|CLEAR|WATCH)$/i.test(r.verdict) && r.independent);
    if (!review) reasons.push("a scope amendment needs an independent review of the candidate");
  }
  return { ok: reasons.length === 0, reasons, ...(candidateDigest ? { candidateDigest } : {}) };
}

/**
 * Apply a reviewed candidate: publish its files, reopen every affected task with its evidence
 * links dropped, and release this amendment's hold. Boxes that were reopened stay reopened: the
 * work they claimed was verified against a contract that no longer exists.
 */
export function applyAmendment(root, { dir, rel, id, inputs = {} }, token) {
  if (!holdsLock(root, token)) throw new IntentIoError('lock-lost', 'amend apply requires the live intent lock token');
  const state = amendmentState(dir);
  const entry = state.all.find((a) => a.id === id);
  if (!entry) throw new IntentIoError('no-such-amendment', `${rel}/amendments/${id} does not exist`);
  if (entry.state !== 'pending') throw new IntentIoError('amendment-closed', `${id} is ${entry.state}; only a pending amendment can be applied`);
  const record = entry.candidate;
  if (!record) throw new IntentIoError('bad-amendment', `${rel}/amendments/${id}/candidate.json is unreadable`);

  const authority = amendmentAuthority(record, listReviews(dir), readManifest(dir)?.review?.lane ?? null);
  if (!authority.ok) throw new IntentIoError('unauthorised-amendment', `${id} cannot be applied: ${authority.reasons.join('; ')}`);

  const nowDigest = currentContractDigest(root, dir, rel, inputs);
  // the canonical text must still be the one this candidate was written against; the hold in
  // tasks.md is bookkeeping and is excluded from the digest by construction (C-03)
  if (nowDigest !== record.oldDigest) {
    throw new IntentIoError('contract-drift', `the approved contract changed while ${id} was pending (${record.oldDigest.slice(0, 12)} -> ${nowDigest.slice(0, 12)}); re-propose against the current text`);
  }

  const steps = [];
  for (const path of record.files) {
    const name = path.slice(rel.length + 1).replace(/[\\/]/g, '__');
    const candidatePath = join(dir, 'amendments', id, 'candidate', name);
    if (!existsSync(candidatePath)) throw new IntentIoError('bad-amendment', `${rel}/amendments/${id}/candidate/${name} is missing`);
    steps.push({ kind: 'file', path, content: lf(readFileSync(candidatePath, 'utf8')) });
  }
  // tasks.md: the candidate's own text if it has one, then the hold released and the affected
  // tasks reopened with their evidence links removed
  const affected = new Set(record.affected);
  const tasksPath = `${rel}/tasks.md`;
  const fromCandidate = steps.find((s) => s.path === tasksPath);
  const base = fromCandidate ? fromCandidate.content : lf(readFileSync(join(dir, 'tasks.md'), 'utf8'));
  const finalTasks = reopenTasks(removeHold(base, id), affected);
  if (fromCandidate) fromCandidate.content = finalTasks;
  else steps.push({ kind: 'file', path: tasksPath, content: finalTasks });
  steps.push({
    kind: 'file',
    path: `${rel}/amendments/${id}/state.json`,
    content: JSON.stringify({ state: 'applied', proposedAt: record.proposedAt, appliedAt: new Date().toISOString(), oldDigest: record.oldDigest, newDigest: record.candidateDigest ?? null }, null, 2) + '\n',
  });
  return { record, steps, affected: [...affected].sort() };
}

/**
 * Cancel a pending amendment: the approved text stays in force and the hold is released. Tasks
 * that were reopened are *not* re-ticked — a box is only ticked by work that was verified.
 */
export function cancelAmendment(root, { dir, rel, id, reason }, token) {
  if (!holdsLock(root, token)) throw new IntentIoError('lock-lost', 'amend cancel requires the live intent lock token');
  const state = amendmentState(dir);
  const entry = state.all.find((a) => a.id === id);
  if (!entry) throw new IntentIoError('no-such-amendment', `${rel}/amendments/${id} does not exist`);
  if (entry.state !== 'pending') throw new IntentIoError('amendment-closed', `${id} is ${entry.state}; only a pending amendment can be cancelled`);
  const tasksText = lf(readFileSync(join(dir, 'tasks.md'), 'utf8'));
  const released = removeHold(tasksText, id);
  const steps = [{ kind: 'file', path: `${rel}/amendments/${id}/state.json`, content: JSON.stringify({ state: 'cancelled', proposedAt: entry.candidate?.proposedAt ?? null, cancelledAt: new Date().toISOString(), reason: reason ?? null }, null, 2) + '\n' }];
  if (released !== tasksText) steps.push({ kind: 'file', path: `${rel}/tasks.md`, content: released });
  return { steps };
}

// ---------------------------------------------------------------- repeated root causes (D-06)
/**
 * A finding is the record that two materially different attempts failed for the same reason.
 * Its purpose is to stop the third blind patch: once a cause has defeated two genuinely
 * different approaches, the next step is design review, not another try.
 *
 * It escalates to a reviewer, not to the user. The user is asked only when the remedy would
 * change scope, which is an amendment (C-07), not a finding.
 */
const findingsDir = (dir) => join(dir, 'findings');

/** Two approaches count as different only if they are described differently. */
const distinctApproaches = (attempts) => new Set(attempts.filter((a) => a.outcome === 'failed').map((a) => String(a.approach ?? '').trim().toLowerCase()).filter(Boolean));

/**
 * What this finding requires next. Below two distinct failed approaches it requires nothing: one
 * failure is a bug, and a second identical attempt is not evidence of a design problem.
 */
export function escalationFor(finding) {
  const distinct = distinctApproaches(finding.attempts ?? []);
  if (finding.resolvedBy) return { required: false, lane: null, distinct: distinct.size, reason: `resolved by ${finding.resolvedBy}` };
  if (distinct.size < 2) {
    return { required: false, lane: null, distinct: distinct.size, reason: `${distinct.size} materially different failed approach(es) so far; a design review is due at two` };
  }
  if (finding.trustBoundaryChanged) {
    return { required: true, lane: 'high', distinct: distinct.size, reason: 'the remedy changes a trust boundary, so it returns to full review (planner, architect, critic)' };
  }
  return { required: true, lane: 'design', distinct: distinct.size, reason: `${distinct.size} materially different approaches failed for the same cause; an architect or planner selects the remedy inside scope before another attempt` };
}

/** Every finding recorded for this change, oldest id first. */
export function listFindings(dir) {
  const d = findingsDir(dir);
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => readJsonIf(join(d, f)))
    .filter((f) => f && !f.unreadable);
}

export const readFinding = (dir, id) => listFindings(dir).find((f) => f.id === id) ?? null;

/**
 * Records one attempt against a finding, creating the finding on the first one. The blocker it
 * writes is task-local: it names the tasks this cause defeated, so every other task in the plan
 * stays runnable while the design question is answered.
 */
export function recordFinding(root, { dir, rel, finding }, token) {
  if (!holdsLock(root, token)) throw new IntentIoError('lock-lost', 'finding record requires the live intent lock token');
  const id = String(finding?.id ?? '').trim();
  if (!/^F-[A-Za-z0-9-]+$/.test(id)) throw new IntentIoError('bad-finding', 'a finding needs an id like F-1');
  if (typeof finding?.cause !== 'string' || !finding.cause.trim()) throw new IntentIoError('bad-finding', 'a finding needs the root cause it identifies');
  const attempt = finding.attempt;
  if (attempt && (typeof attempt.approach !== 'string' || !attempt.approach.trim())) throw new IntentIoError('bad-finding', 'an attempt needs an approach describing what was tried');

  const existing = readFinding(dir, id);
  const record = {
    schemaVersion: 2,
    id,
    changeId: readManifest(dir)?.id ?? null,
    cause: existing?.cause ?? finding.cause,
    tasks: [...new Set([...(existing?.tasks ?? []), ...(finding.tasks ?? [])])].sort(),
    trustBoundaryChanged: finding.trustBoundaryChanged ?? existing?.trustBoundaryChanged ?? false,
    attempts: [...(existing?.attempts ?? []), ...(attempt ? [{ approach: attempt.approach, outcome: attempt.outcome ?? 'failed', evidenceRef: attempt.evidenceRef ?? null, at: new Date().toISOString() }] : [])],
    resolvedBy: existing?.resolvedBy ?? null,
    opened: existing?.opened ?? new Date().toISOString(),
  };
  const escalation = escalationFor(record);
  const steps = [{ kind: 'file', path: `${rel}/findings/${id}.json`, content: JSON.stringify(record, null, 2) + '\n' }];
  if (escalation.required && record.tasks.length) {
    const tasksText = lf(readFileSync(join(dir, 'tasks.md'), 'utf8'));
    const held = applyFindingHold(tasksText, new Set(record.tasks), id, escalation.lane);
    if (held !== tasksText) steps.push({ kind: 'file', path: `${rel}/tasks.md`, content: held });
  }
  return { record, escalation, steps };
}

const findingNote = (id, lane) => `${id} needs ${lane === 'high' ? 'full design review' : 'design review'} before another attempt`;

/**
 * The finding's blocker, appended to whatever the task already said. A held task is *not*
 * reopened: unlike an amendment, a repeated failure does not invalidate work that was verified.
 */
export function applyFindingHold(tasksText, tasks, id, lane) {
  const parsed = parseTasksMarkdown(tasksText);
  const lines = lf(tasksText).split('\n');
  const note = findingNote(id, lane);
  for (const task of parsed.tasks) {
    if (!task.id || !tasks.has(task.id)) continue;
    const blockedAt = lines.slice(task.line, task.endLine).findIndex((l) => /^\s+- blocked:/.test(l));
    if (blockedAt >= 0) {
      const at = task.line + blockedAt;
      if (!lines[at].includes(note)) lines[at] = `${lines[at].replace(/\s+$/, '')}; ${note}`;
      continue;
    }
    const indent = /^(\s*)- \[/.exec(lines[task.line - 1])[1];
    lines.splice(task.endLine, 0, `${indent}  - blocked: ${note}`);
    return applyFindingHold(lines.join('\n'), tasks, id, lane);
  }
  return lines.join('\n');
}

/** Resolves a finding: the reviewer chose a remedy, and the tasks it held are released. */
export function resolveFinding(root, { dir, rel, id, reviewId, remedy }, token) {
  if (!holdsLock(root, token)) throw new IntentIoError('lock-lost', 'finding resolve requires the live intent lock token');
  const existing = readFinding(dir, id);
  if (!existing) throw new IntentIoError('no-such-finding', `${rel}/findings/${id}.json does not exist`);
  if (!reviewId) throw new IntentIoError('bad-finding', 'resolving a finding names the review that chose the remedy');
  const review = listReviews(dir).find((r) => r.id === reviewId);
  if (!review) throw new IntentIoError('no-such-review', `${rel}/reviews/${reviewId} does not exist; record the design review before resolving the finding`);
  if (!['architect', 'planner', 'critic'].includes(review.role)) throw new IntentIoError('bad-review-role', `a finding is resolved by a design review (architect, planner or critic), not by a ${review.role} review`);
  const record = { ...existing, resolvedBy: reviewId, remedy: remedy ?? null, resolvedAt: new Date().toISOString() };
  const steps = [{ kind: 'file', path: `${rel}/findings/${id}.json`, content: JSON.stringify(record, null, 2) + '\n' }];
  const tasksText = lf(readFileSync(join(dir, 'tasks.md'), 'utf8'));
  const released = removeFindingHold(tasksText, id);
  if (released !== tasksText) steps.push({ kind: 'file', path: `${rel}/tasks.md`, content: released });
  return { record, steps };
}

/** Removes only this finding's note, leaving every other blocker exactly as it was. */
export function removeFindingHold(tasksText, id) {
  const note = new RegExp(`;?\\s*${id} needs (?:full )?design review before another attempt`);
  return lf(tasksText)
    .split('\n')
    .flatMap((line) => {
      if (!/^\s+- blocked:/.test(line) || !note.test(line)) return [line];
      const stripped = line.replace(note, '').replace(/\s+$/, '');
      return /^\s+- blocked:\s*$/.test(stripped) ? [] : [stripped];
    })
    .join('\n');
}

// ---------------------------------------------------------------- review lanes (D-07, C-07)
/**
 * Risk decides how much review a contract needs before anything may rely on it. The judgement
 * itself — which risk categories a change touches — stays where it already lives, in `mf-plan`,
 * read from the proposal and the paths it names. This section does the mechanical part: it turns
 * that judgement plus the explicit flags into one recorded lane, and says what each lane must
 * show before the contract counts as approved.
 *
 * Two rules are the point of the whole thing. A lane is never silently downgraded: a wider scope
 * can raise it, nothing lowers it but a new decision. And selecting a lane approves nothing —
 * `spec lane select` records an intention, and only the reviews the lane names make a contract
 * eligible to be implemented, verified or archived.
 */
export const RISK_CATEGORIES = ['auth', 'migrations', 'destructive-operations', 'public-api', 'build-config', 'engine-modules'];
export const LANES = ['low', 'medium', 'high'];
const LANE_RANK = { low: 0, medium: 1, high: 2 };
/** The higher of two lanes, so escalation is the only direction a comparison can move. */
export const higherLane = (a, b) => (LANE_RANK[a] >= LANE_RANK[b] ? a : b);

/**
 * The lane this change should run in, with every reason it landed there. Flags are requests,
 * not overrides: `--deliberate` forces high, `--fast` asks for medium and is refused outright
 * when the automatic lane is high, and `--go` means nothing without `--fast`.
 */
export function selectLane({ categories = [], paths = [], multiFile = false, uncertain = false, current = null, fast = false, deliberate = false, go = false } = {}) {
  const unknown = categories.filter((c) => !RISK_CATEGORIES.includes(c));
  if (unknown.length) throw new IntentIoError('bad-lane', `unknown risk category: ${unknown.join(', ')} (known: ${RISK_CATEGORIES.join(', ')})`);
  if (current !== null && !LANES.includes(current)) throw new IntentIoError('bad-lane', `unknown lane "${current}" (expected one of: ${LANES.join(', ')})`);

  const reasons = [];
  const refusals = [];
  let lane;
  if (categories.length) {
    lane = 'high';
    reasons.push(`high-risk categories: ${categories.join(', ')}`);
  } else if (uncertain) {
    lane = 'high';
    reasons.push('the approach is not yet known, and an uncertain change is reviewed as a high-risk one');
  } else if (multiFile) {
    lane = 'medium';
    reasons.push('several files with a design that is already clear');
  } else {
    lane = 'low';
    reasons.push('one reversible file with a known approach and explicit acceptance');
  }
  const automatic = lane;

  if (deliberate) {
    lane = 'high';
    reasons.push('--deliberate was requested, which asks for the full lane whatever the automatic one was');
  }
  if (fast) {
    if (deliberate) refusals.push('--fast and --deliberate were both requested; --deliberate wins');
    else if (automatic === 'high') refusals.push(`--fast is refused here: ${reasons[0]}`);
    else {
      lane = 'medium';
      reasons.push('--fast was requested, which asks for the medium lane (one critic pass, no drafting role and no architect)');
    }
  }
  if (go && !fast) refusals.push('--go requires --fast; planning only');

  if (current !== null) {
    const kept = higherLane(lane, current);
    if (kept !== lane) reasons.push(`the recorded lane ${current} is kept: a new selection may escalate a lane, never downgrade one`);
    lane = kept;
  }
  const acceptedFast = fast && !deliberate && lane === 'medium';
  if (fast && current === 'high' && automatic !== 'high' && !deliberate) refusals.push('--fast is refused here: the recorded high lane is retained');
  if (go && fast && !acceptedFast) refusals.push('--go is refused because --fast was not accepted; planning only');
  return {
    lane,
    automatic,
    reasons,
    refusals,
    categories: [...categories],
    paths: [...paths].map(toSlash).sort(),
    flags: { fast: acceptedFast, deliberate, go: go && acceptedFast },
    // stated in the record itself, because a selection is the cheapest thing to mistake for one
    authorizesImplementation: false,
  };
}

/**
 * Every lane this change has been recorded in, oldest first. The lane decides how much review
 * the contract needs, so it is history like everything else that decides that: a change of lane
 * is appended, never overwritten, and a downgrade has to survive being read later.
 */
export function laneHistory(dir) {
  const d = join(dir, 'lanes');
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => readJsonIf(join(d, f)))
    .filter((r) => r && !r.unreadable);
}

/**
 * Plan a lane change. Escalation is free. A downgrade is refused once any review has been
 * recorded at a higher lane — that review was written against a stricter standard, and letting
 * a cheaper lane inherit it would make `lane set --force` the cheapest link in the whole design.
 */
export function planLaneChange(root, { dir, rel, lane, reason, paths = [], force = false }) {
  if (!LANES.includes(lane)) throw new IntentIoError('bad-lane', `unknown lane "${lane}" (expected one of: ${LANES.join(', ')})`);
  if (!String(reason ?? '').trim()) throw new IntentIoError('bad-lane', 'a recorded lane names the risk rationale it was chosen for');
  const manifest = readManifest(dir);
  if (!manifest) throw new IntentIoError('no-identity', `${rel} has no ${MANIFEST_FILE}; upgrade the change before recording a review lane`);
  const current = manifest.review?.lane ?? null;
  const history = laneHistory(dir);
  if (current && higherLane(current, lane) !== lane) {
    if (!force) throw new IntentIoError('lane-downgrade', `${rel} is recorded as the ${current} lane; a change to ${lane} is a downgrade and needs --force`);
    const stricter = listReviews(dir).length;
    if (stricter) {
      throw new IntentIoError(
        'lane-downgrade-reviewed',
        `${rel} already carries ${stricter} review(s) recorded under the ${current} lane; a downgrade cannot inherit them. Record the ${lane} lane on a change that has not been reviewed, or keep the lane it was reviewed in.`
      );
    }
  }
  const record = {
    schemaVersion: 2,
    sequence: history.length + 1,
    changeId: manifest.id,
    lane,
    reason,
    paths: [...paths],
    previous: current,
    direction: current === null ? 'initial' : higherLane(current, lane) === lane && current !== lane ? 'escalation' : current === lane ? 'restated' : 'downgrade',
    forced: !!force,
    recordedAt: new Date().toISOString(),
  };
  const steps = [{ kind: 'file', path: `${rel}/lanes/L-${String(record.sequence).padStart(2, '0')}.json`, content: JSON.stringify(record, null, 2) + '\n' }];
  return { record, steps, review: { lane, reason, paths: record.paths } };
}

/** What a lane must show. Roles are the review records it needs, not the agents that produced them. */
export function laneRequirements(lane) {
  if (!LANES.includes(lane)) throw new IntentIoError('bad-lane', `unknown lane "${lane}" (expected one of: ${LANES.join(', ')})`);
  if (lane === 'high') return { lane, roles: ['planner', 'architect', 'critic'], summary: 'a planner draft, an independent architect CLEAR or WATCH with no blocking finding, and an independent critic OKAY' };
  if (lane === 'medium') return { lane, roles: ['critic'], summary: 'an independent critic OKAY' };
  return { lane, roles: [], summary: 'an explicit acceptance contract and a recorded risk rationale' };
}

const OKAY_RE = /^(OKAY|OK|APPROVED?)$/i;
const CLEAR_RE = /^(CLEAR|WATCH)$/i;
const blockingFinding = (review) => (review.findings ?? []).some((f) => (typeof f === 'string' ? /block/i.test(f) : f?.blocking === true || /^BLOCK$/i.test(f?.severity ?? '')));

/**
 * Whether the reviews on record approve this exact contract digest for this lane. Only direct
 * reviews of the contract count here; reviews of an amendment candidate belong to the chain.
 */
export function laneApproval(lane, reviews, digest, { rationale = null, acceptanceComplete = true, amendment = null } = {}) {
  const requirements = laneRequirements(lane);
  // a review of an amendment candidate belongs to that candidate, and to nothing else
  const forDigest = reviews.filter((r) => (amendment ? r.amendment === amendment : r.contractDigest === digest && !r.amendment));
  const reasons = [];
  const used = [];
  const take = (role, ok, why) => {
    const found = forDigest.find((r) => r.role === role && ok(r));
    if (found) used.push(found.id);
    else reasons.push(why);
    return found;
  };
  if (lane === 'high') {
    take('planner', () => true, 'the high lane needs a recorded planner draft of this contract');
    take('architect', (r) => r.independent && CLEAR_RE.test(r.verdict) && !blockingFinding(r), 'the high lane needs an independent architect review of this contract with CLEAR or WATCH and no blocking finding');
    take('critic', (r) => r.independent && OKAY_RE.test(r.verdict), 'the high lane needs an independent critic OKAY of this contract');
  } else if (lane === 'medium') {
    take('critic', (r) => r.independent && OKAY_RE.test(r.verdict), 'the medium lane needs an independent critic OKAY of this contract');
  } else {
    if (!acceptanceComplete) reasons.push('the low lane needs an explicit acceptance contract: every required criterion names its evidence mode and its checks');
    if (!String(rationale ?? '').trim()) reasons.push('the low lane needs a recorded risk rationale (the reason field of the recorded lane)');
  }
  return { approved: reasons.length === 0, lane, requirements, reasons, used };
}

/**
 * The shared eligibility answer: this digest is approved either directly, or through a chain of
 * applied amendments that leads back to a digest that was. Every link binds its predecessor's
 * exact new digest, so an unrelated edit between two amendments breaks the chain instead of
 * quietly carrying an old approval forward.
 */
export function approvalChain({ digest, lane, reviews, amendments, rationale = null, acceptanceComplete = true }) {
  const direct = laneApproval(lane, reviews, digest, { rationale, acceptanceComplete });
  if (direct.approved) return { approved: true, via: 'direct', chain: [], lane, reasons: [], requirements: direct.requirements, used: direct.used };

  const reasons = [...direct.reasons];
  const chain = [];
  const seen = new Set();
  let cursor = digest;
  for (;;) {
    const link = amendments.find((a) => a.state === 'applied' && a.newDigest && a.newDigest === cursor);
    if (!link) break;
    if (seen.has(link.id)) {
      reasons.push(`the amendment chain revisits ${link.id}; a cycle never reaches an approved base`);
      break;
    }
    seen.add(link.id);
    if (!link.candidate) {
      reasons.push(`${link.id} has no readable candidate, so the chain cannot be checked`);
      break;
    }
    const authority = amendmentAuthority(link.candidate, reviews, lane);
    if (!authority.ok) {
      reasons.push(`${link.id} does not carry the authority its type requires: ${authority.reasons.join('; ')}`);
      break;
    }
    if (!link.oldDigest || link.oldDigest !== link.candidate.oldDigest) {
      reasons.push(`${link.id} does not bind the digest it was written against, so the chain is broken at that link`);
      break;
    }
    chain.push(link.id);
    cursor = link.oldDigest;
    const base = laneApproval(lane, reviews, cursor, { rationale, acceptanceComplete });
    if (base.approved) return { approved: true, via: 'chain', chain: [...chain], lane, reasons: [], requirements: base.requirements, used: base.used };
  }
  if (chain.length) reasons.push(`the applied amendment chain (${chain.join(' <- ')}) leads to ${cursor.slice(0, 12)}, which is not approved for the ${lane} lane either`);
  return { approved: false, via: null, chain, lane, reasons, requirements: direct.requirements, used: [] };
}

/**
 * What makes a linked contract executable (C-01): every working task declares its prerequisites
 * and the criterion it satisfies, every required criterion says how it will be shown and what
 * will be run, and the graph carries no structural error. `stage execute`, `evidence begin` and
 * `archive` all ask this one question, so none of them can drift from the others.
 */
export function executableContractProblems(dir, rel) {
  const intent = readChangeIntentDir(dir, rel.split('/').pop(), { rel });
  const problems = [];
  const structural = intent.diagnostics.filter((d) => d.severity === 'error');
  if (structural.length) problems.push({ code: 'invalid-contract', message: `the linked contract has ${structural.length} structural error(s): ${structural.map((d) => d.message).join('; ')}` });
  for (const node of intent.graph.nodes.values()) {
    if (node.task.kind === 'closeout') continue;
    if (node.task.dependsOn === null) problems.push({ code: 'undeclared-dependency', message: `task ${node.id} never declares its prerequisites; write "- depends-on: none" if it has none` });
    if (node.task.accepts === null) problems.push({ code: 'unlinked-task', message: `task ${node.id} names no acceptance criterion` });
  }
  for (const c of intent.acceptance.criteria.filter((x) => x.required)) {
    if (!(c.evidenceModes ?? []).length) problems.push({ code: 'incomplete-acceptance', message: `required criterion ${c.id} declares no evidence mode` });
    if (!c.checks) problems.push({ code: 'incomplete-acceptance', message: `required criterion ${c.id} names no checks` });
  }
  return problems;
}

/** True when every required criterion says how it will be shown and what will be run. */
function acceptanceIsExplicit(dir, rel) {
  const slug = rel.split('/').pop();
  const criteria = readChangeIntentDir(dir, slug, { rel }).acceptance.criteria;
  return criteria.length > 0 && criteria.every((c) => !c.required || ((c.evidenceModes ?? []).length > 0 && !!c.checks));
}

/**
 * The one approval answer `stage execute`, `evidence begin` and `archive` all read (C-07). A change
 * that has not recorded a lane is not refused — it is undeclared, and the caller decides what an
 * undeclared change may do. A change that has recorded one is held to it.
 */
export function contractApproval(root, { dir, rel, inputs = null }) {
  const manifest = readManifest(dir);
  const lane = manifest?.review?.lane ?? null;
  if (!manifest) return { declared: false, lane: null, digest: null, approved: false, via: null, chain: [], reasons: [`${rel} has no ${MANIFEST_FILE}; a legacy change carries no recorded review lane`] };
  const digest = currentContractDigest(root, dir, rel, inputs);
  if (!lane) {
    return { declared: false, lane: null, digest, approved: false, via: null, chain: [], reasons: [`${rel} has not recorded a review lane; run "spec lane set ${manifest.slug} --lane <low|medium|high> --reason ..."`] };
  }
  const result = approvalChain({
    digest,
    lane,
    reviews: listReviews(dir),
    amendments: amendmentState(dir).all,
    rationale: manifest.review.reason ?? null,
    acceptanceComplete: acceptanceIsExplicit(dir, rel),
  });
  return { declared: true, lane, digest, approved: result.approved, via: result.via, chain: result.chain, reasons: result.reasons, requirements: result.requirements, used: result.used };
}

/**
 * Diff view: git detection, the working-tree diff routes, and the pure client helpers the diff
 * page and theme control use. Git-dependent cases skip (visibly) when git is not installed.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { startServer } from '../scripts/dashboard.mjs';
import { ancestorDirs, buildTree, diffNav, flattenTree, normalizeTheme, parseRoute, parseUnifiedDiff, shouldRefetch, themeAttr } from '../web/app.mjs';
import { cleanup, gitInit, hasGit, makeTmp, write } from './helpers.mjs';

const GIT = hasGit();
const gitRun = (cwd, args) => {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

/** A repository with one commit, then a modified, a deleted, an untracked text and an untracked binary file; no .gitignore. */
function gitFixture() {
  const root = makeTmp('diff');
  gitInit(root);
  write(root, 'keep.md', 'line one\nline two\n');
  write(root, 'gone.md', 'to be deleted\n');
  write(root, 'same.md', 'unchanged\n');
  write(root, '.my-flow/ask/x.md', '# ask\n');
  gitRun(root, ['add', '-A']);
  gitRun(root, ['commit', '-q', '-m', 'fixture']);
  write(root, 'keep.md', 'line one\nline two changed\nline three\n');
  rmSync(join(root, 'gone.md'));
  write(root, 'fresh.md', 'brand new\nno newline at end');
  writeFileSync(join(root, 'blob.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  write(root, '.my-flow/ask/x.md', '# ask changed\n');
  write(root, '.my-flow/state/current-change.json', JSON.stringify({ change: 'x', stage: 'new', updated: new Date().toISOString() }));
  return root;
}

async function up(t, root) {
  const h = await startServer({ root, port: 0 });
  t.after(async () => {
    await h.close();
    cleanup(root);
  });
  const getJson = async (path) => {
    const r = await fetch(h.url + path.replace(/^\//, ''));
    return { status: r.status, json: await r.json() };
  };
  return { h, getJson };
}

test('diff: lists modified, deleted and untracked files with statuses and counts', { skip: !GIT && 'git is not installed' }, async (t) => {
  const { getJson } = await up(t, gitFixture());
  const health = await getJson('/api/health');
  assert.equal(health.json.git, true);
  const { status, json } = await getJson('/api/diff');
  assert.equal(status, 200);
  assert.equal(json.git, true);
  assert.equal(json.base, 'HEAD');
  assert.match(json.head, /^[0-9a-f]{40}$/);
  const by = Object.fromEntries(json.files.map((f) => [f.path, f]));
  assert.equal(by['keep.md'].status, 'M');
  assert.equal(by['keep.md'].added, 2);
  assert.equal(by['keep.md'].deleted, 1);
  assert.equal(by['keep.md'].untracked, false);
  assert.equal(typeof by['keep.md'].mtimeMs, 'number');
  assert.ok(by['keep.md'].mtimeMs > 0);
  assert.equal(by['gone.md'].status, 'D');
  assert.equal(by['gone.md'].deleted, 1);
  assert.equal(by['gone.md'].mtimeMs, null, 'a deleted file has no time');
  assert.equal(by['fresh.md'].status, '?');
  assert.equal(by['fresh.md'].untracked, true);
  assert.equal(by['fresh.md'].added, null);
  assert.equal(typeof by['fresh.md'].mtimeMs, 'number');
  assert.equal(by['same.md'], undefined, 'an unchanged file is not listed');
});

test("diff: mtimeMs is the file's own lstat time and moves when the file is rewritten", { skip: !GIT && 'git is not installed' }, async (t) => {
  const root = gitFixture();
  const { getJson } = await up(t, root);
  const first = await getJson('/api/diff');
  const before = first.json.files.find((f) => f.path === 'keep.md').mtimeMs;
  assert.equal(before, lstatSync(join(root, 'keep.md')).mtimeMs);
  write(root, 'keep.md', 'line one\nline two changed again\nline three\nline four\n');
  const second = await getJson('/api/diff');
  const after = second.json.files.find((f) => f.path === 'keep.md').mtimeMs;
  assert.equal(after, lstatSync(join(root, 'keep.md')).mtimeMs);
  assert.ok(after >= before, `rewritten file time ${after} is not before ${before}`);
});

test('diff: a unified patch for a modified, a deleted and an untracked file', { skip: !GIT && 'git is not installed' }, async (t) => {
  const { getJson } = await up(t, gitFixture());
  const mod = await getJson('/api/diff/file?path=keep.md');
  assert.equal(mod.status, 200);
  assert.ok(mod.json.patch.startsWith('diff --git a/keep.md b/keep.md'));
  assert.match(mod.json.patch, /^-line two$/m);
  assert.match(mod.json.patch, /^\+line two changed$/m);
  assert.match(mod.json.patch, /^\+line three$/m);
  assert.equal(mod.json.truncated, false);
  const del = await getJson('/api/diff/file?path=gone.md');
  assert.equal(del.json.status, 'D');
  assert.match(del.json.patch, /^\+\+\+ \/dev\/null$/m);
  assert.match(del.json.patch, /^-to be deleted$/m);
  const fresh = await getJson('/api/diff/file?path=fresh.md');
  assert.equal(fresh.json.status, '?');
  assert.equal(fresh.json.patch, 'diff --git a/fresh.md b/fresh.md\nnew file mode 100644\n--- /dev/null\n+++ b/fresh.md\n@@ -0,0 +1,2 @@\n+brand new\n+no newline at end\n\\ No newline at end of file\n');
});

test('diff: a binary untracked file is listed with binary:true and no patch', { skip: !GIT && 'git is not installed' }, async (t) => {
  const { getJson } = await up(t, gitFixture());
  const list = await getJson('/api/diff');
  const blob = list.json.files.find((f) => f.path === 'blob.bin');
  assert.equal(blob.binary, true);
  assert.equal(blob.untracked, true);
  const patch = await getJson('/api/diff/file?path=blob.bin');
  assert.equal(patch.status, 200);
  assert.equal(patch.json.binary, true);
  assert.equal(patch.json.patch, null);
});

test('diff: a path the diff does not list is refused, including real files and the state file', { skip: !GIT && 'git is not installed' }, async (t) => {
  const { getJson } = await up(t, gitFixture());
  for (const path of ['same.md', '.my-flow/state/current-change.json', '.my-flow/ask/x.md', '../outside.md', '']) {
    const r = await getJson(`/api/diff/file?path=${encodeURIComponent(path)}`);
    assert.equal(r.status, 400, path);
    assert.equal(r.json.error, 'not-in-diff', path);
  }
});

test('diff: nothing under .my-flow/ is listed even without a .gitignore', { skip: !GIT && 'git is not installed' }, async (t) => {
  const root = gitFixture();
  const { getJson } = await up(t, root);
  assert.equal(readFileSync(join(root, '.my-flow', 'ask', 'x.md'), 'utf8'), '# ask changed\n', 'the scratch file really is modified');
  const { json } = await getJson('/api/diff');
  assert.ok(json.files.length >= 3);
  assert.ok(json.files.every((f) => !f.path.startsWith('.my-flow/')), JSON.stringify(json.files.map((f) => f.path)));
});

test('diff: an untracked symlink is listed but never followed', { skip: !GIT && 'git is not installed' }, async (t) => {
  const root = gitFixture();
  const target = makeTmp('diff-target');
  write(target, 'secret.md', 'outside the root\n');
  try {
    symlinkSync(join(target, 'secret.md'), join(root, 'link.md'), 'file');
  } catch (e) {
    cleanup(target);
    cleanup(root);
    t.skip(`symlinkSync not permitted on this machine (${e.code})`);
    return;
  }
  t.after(() => cleanup(target));
  const { getJson } = await up(t, root);
  const list = await getJson('/api/diff');
  assert.ok(list.json.files.some((f) => f.path === 'link.md' && f.untracked));
  assert.equal(list.json.files.find((f) => f.path === 'link.md').mtimeMs, lstatSync(join(root, 'link.md')).mtimeMs, "the link's own time, never the target's");
  const r = await getJson('/api/diff/file?path=link.md');
  assert.equal(r.status, 200);
  assert.equal(r.json.skipped, 'not-a-regular-file');
  assert.equal(r.json.patch, null);
});

test('diff: without git the routes answer no-git and the other pages still work', async (t) => {
  const root = makeTmp('nogit');
  write(root, 'changes/demo/tasks.md', '- [ ] 1.1 a and verify b\n');
  mkdirSync(join(root, 'specs'), { recursive: true });
  const { getJson } = await up(t, root);
  const health = await getJson('/api/health');
  if (health.json.git === true) {
    t.skip(`the temp fixture ${root} sits inside a git work tree, so the no-git case is not observable here`);
    return;
  }
  assert.equal(health.json.git, false);
  for (const path of ['/api/diff', '/api/diff/file?path=x']) {
    const r = await getJson(path);
    assert.equal(r.status, 404, path);
    assert.equal(r.json.error, 'no-git', path);
  }
  for (const path of ['/api/status', '/api/specs', '/api/archive', '/api/scratch']) assert.equal((await getJson(path)).status, 200, path);
});

// ---------------------------------------------------------------- pure client helpers
test('client: parseUnifiedDiff splits hunks, classifies lines and numbers both sides', () => {
  const patch = ['diff --git a/x.md b/x.md', 'index 1..2 100644', '--- a/x.md', '+++ b/x.md', '@@ -1,3 +1,3 @@', ' one', '-two', '+TWO', ' three', '@@ -10,2 +10,3 @@', ' ten', '+ten and a half', ' eleven', '\\ No newline at end of file', ''].join('\n');
  const p = parseUnifiedDiff(patch);
  assert.deepEqual(p.header, ['diff --git a/x.md b/x.md', 'index 1..2 100644', '--- a/x.md', '+++ b/x.md']);
  assert.equal(p.hunks.length, 2);
  assert.equal(p.hunks[0].header, '@@ -1,3 +1,3 @@');
  assert.deepEqual(p.hunks[0].lines, [
    { kind: 'ctx', oldNo: 1, newNo: 1, text: 'one' },
    { kind: 'del', oldNo: 2, newNo: null, text: 'two' },
    { kind: 'add', oldNo: null, newNo: 2, text: 'TWO' },
    { kind: 'ctx', oldNo: 3, newNo: 3, text: 'three' },
  ]);
  assert.deepEqual(p.hunks[1].lines.map((l) => [l.kind, l.oldNo, l.newNo]), [['ctx', 10, 10], ['add', null, 11], ['ctx', 11, 12], ['meta', null, null]]);
  assert.equal(p.hunks[1].lines[3].text, 'No newline at end of file');
  assert.deepEqual(parseUnifiedDiff(''), { header: [], hunks: [] });
  assert.deepEqual(parseUnifiedDiff(null), { header: [], hunks: [] });
  assert.equal(parseUnifiedDiff('@@ -0,0 +1,2 @@\n+a\n+b\n').hunks[0].lines[1].newNo, 2);
});

test('client: buildTree nests directories, sorts dirs before files, keeps root files at the root', () => {
  const files = ['web/app.mjs', 'README.md', 'web/app.css', 'test/x/deep.mjs', 'a.md'].map((path) => ({ path }));
  const tree = buildTree(files);
  assert.deepEqual(tree.files.map((f) => f.path), ['README.md', 'a.md']);
  assert.deepEqual(tree.dirs.map((d) => d.name), ['test', 'web']);
  assert.deepEqual(tree.dirs[1].files.map((f) => f.path), ['web/app.css', 'web/app.mjs']);
  assert.equal(tree.dirs[0].dirs[0].path, 'test/x');
  assert.deepEqual(tree.dirs[0].dirs[0].files.map((f) => f.path), ['test/x/deep.mjs']);
  assert.deepEqual(buildTree([]), { name: '', path: '', dirs: [], files: [] });
});

test('client: diff keyboard navigation helpers', () => {
  const entry = (path, mtimeMs = null) => ({ path, mtimeMs });
  // 1. an empty tree flattens to nothing
  assert.deepEqual(flattenTree(buildTree([])), []);
  // 2. every directory subtree before the root's own files, matching the render order in pageDiff
  const tree = buildTree(['web/app.mjs', 'README.md', 'web/app.css', 'test/x/deep.mjs', 'a.md'].map((p) => entry(p)));
  assert.deepEqual(
    flattenTree(tree).map((f) => f.path),
    ['test/x/deep.mjs', 'web/app.css', 'web/app.mjs', 'README.md', 'a.md'],
  );
  // 3. an empty list
  assert.deepEqual(diffNav([], null), { next: null, prev: null, latest: null });
  const files = [entry('a.md', 10), entry('b.md', 30), entry('c.md', 20)];
  // 4. no current path: first and last
  assert.deepEqual(diffNav(files, null), { next: 'a.md', prev: 'c.md', latest: 'b.md' });
  // 5. an unknown current path behaves like none
  assert.deepEqual(diffNav(files, 'not/in/the/list.md'), { next: 'a.md', prev: 'c.md', latest: 'b.md' });
  // 6. a middle entry has its neighbours
  assert.deepEqual(diffNav(files, 'b.md'), { next: 'c.md', prev: 'a.md', latest: 'b.md' });
  // 7. wrap-around at both ends
  assert.equal(diffNav(files, 'c.md').next, 'a.md');
  assert.equal(diffNav(files, 'a.md').prev, 'c.md');
  // 8. a one-entry list points at itself both ways
  assert.deepEqual(diffNav([entry('only.md', 5)], 'only.md'), { next: 'only.md', prev: 'only.md', latest: 'only.md' });
  // 9. latest is the greatest numeric time even with a null-time (deleted) entry present
  assert.equal(diffNav([entry('gone.md', null), entry('old.md', 1), entry('new.md', 99)], null).latest, 'new.md');
  // 10. every time null: no latest
  assert.equal(diffNav([entry('x.md'), entry('y.md')], null).latest, null);
  // 11. a tie on the greatest time keeps the earlier entry in list order
  assert.equal(diffNav([entry('first.md', 7), entry('second.md', 7), entry('older.md', 1)], null).latest, 'first.md');
  // 12. ancestorDirs
  assert.deepEqual(ancestorDirs('a/b/c.md'), ['a', 'a/b']);
  assert.deepEqual(ancestorDirs('root.md'), []);
  assert.deepEqual(ancestorDirs(null), []);
});

test('client: theme helpers', () => {
  assert.equal(normalizeTheme('light'), 'light');
  assert.equal(normalizeTheme('dark'), 'dark');
  assert.equal(normalizeTheme('x'), 'system');
  assert.equal(normalizeTheme(null), 'system');
  assert.equal(themeAttr('system'), null);
  assert.equal(themeAttr('dark'), 'dark');
});

test('client: diff routes and refetch rules', () => {
  assert.deepEqual(parseRoute('#/diff'), { page: 'diff', path: null });
  assert.deepEqual(parseRoute('#/diff/web%2Fapp.css'), { page: 'diff', path: 'web/app.css' });
  assert.equal(shouldRefetch({ page: 'diff', path: null }, ['anything/at/all']), true);
  assert.equal(shouldRefetch({ page: 'file', path: 'specs/dashboard/spec.md' }, ['.my-flow/state/current-change.json']), true);
  assert.equal(shouldRefetch({ page: 'file', path: 'specs/dashboard/spec.md' }, ['changes/x/tasks.md']), false);
  assert.equal(shouldRefetch({ page: 'archive' }, ['specs/cap/spec.md']), false);
});

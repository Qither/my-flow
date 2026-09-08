#!/usr/bin/env node
/**
 * SessionStart hook (Claude Code + Codex): inject the active change status so a fresh
 * session knows where the previous one stopped. Pure file scan, no external tools.
 * Always exits 0; fails open.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readHookInput } from './lib/stdin.mjs';

const skip = (process.env.MY_FLOW_SKIP_HOOKS ?? '').split(',').map((s) => s.trim());
if (skip.includes('session-context') || skip.includes('all')) {
  process.stdout.write('{}');
  process.exit(0);
}

const input = await readHookInput();
const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
const changesDir = join(cwd, 'changes');
const lines = [];

const read = (p) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};
function countTasks(tasksPath) {
  const text = read(tasksPath);
  if (text === null) return null;
  const done = (text.match(/^\s*- \[x\]/gim) ?? []).length;
  const open = (text.match(/^\s*- \[ \]/gm) ?? []).length;
  return { done, total: done + open };
}
const norm = (s) => (s ?? '').replace(/\r\n/g, '\n').trim();
function artifacts(dir) {
  return ['proposal', 'design', 'tasks']
    .map((f) => {
      const t = read(join(dir, `${f}.md`));
      if (t === null) return `${f}=missing`;
      const tpl = read(join(changesDir, '.templates', `${f}.md`));
      if (tpl !== null && norm(tpl) === norm(t)) return `${f}=empty`; // untouched template
      const meaningful = t.replace(/<!--[\s\S]*?-->/g, '').split('\n').some((l) => l.trim() && !/^#/.test(l.trim()));
      return `${f}=${meaningful ? 'done' : 'empty'}`;
    })
    .join(' ');
}

let current = null;
try {
  current = JSON.parse(read(join(cwd, '.my-flow', 'state', 'current-change.json')) ?? 'null');
} catch {
  current = null;
}

if (existsSync(changesDir)) {
  const changes = readdirSync(changesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'archive' && !d.name.startsWith('.') && !d.name.startsWith('_'))
    .map((d) => d.name)
    .sort();
  if (changes.length) {
    lines.push('Active changes (changes/<name>/):');
    for (const n of changes.slice(0, 8)) {
      const t = countTasks(join(changesDir, n, 'tasks.md'));
      const mark = current?.change === n ? ` <- current (stage: ${current.stage ?? 'unknown'})` : '';
      lines.push(`- ${n}: ${t ? `${t.done}/${t.total} tasks ticked` : 'no tasks.md'}; ${artifacts(join(changesDir, n))}${mark}`);
    }
    if (changes.length > 8) lines.push(`- ... ${changes.length - 8} more`);
  } else {
    lines.push('changes/ exists but has no active change.');
  }
  lines.push('Flow (my-flow skills): interview -> blueprint -> execute -> audit. tasks.md checkboxes are the only progress ledger; design.md Do-Not-Touch and Rebuild / Re-run sections are hard rules.');
} else if (current?.change) {
  lines.push(`Current change "${current.change}" (stage: ${current.stage ?? 'unknown'}), simple mode (docs/changes/).`);
}

if (!lines.length) {
  process.stdout.write('{}');
  process.exit(0);
}

const text = `[my-flow]\n${lines.join('\n')}`;
process.stdout.write(
  JSON.stringify({
    systemMessage: text,
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text },
  })
);
process.exit(0);

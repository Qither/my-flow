#!/usr/bin/env node
/**
 * SessionStart hook (Claude Code + Codex): inject the active OpenSpec change status so a
 * fresh session knows where the previous one stopped. Always exits 0; fails open.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readHookInput } from './lib/stdin.mjs';

const skip = (process.env.MY_FLOW_SKIP_HOOKS ?? '').split(',').map((s) => s.trim());
if (skip.includes('session-context') || skip.includes('all')) {
  process.stdout.write('{}');
  process.exit(0);
}

const input = await readHookInput();
const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
const specRoot = join(cwd, 'openspec');
const lines = [];

function runOpenspec(args) {
  try {
    // openspec is an npm shim (.cmd on Windows), so it must go through a shell; pass one
    // pre-joined string to avoid Node's shell+array deprecation. Args here contain no spaces.
    const r = spawnSync(['openspec', ...args].join(' '), {
      cwd,
      encoding: 'utf8',
      timeout: 5000,
      shell: true,
      windowsHide: true,
    });
    if (r.status !== 0 || !r.stdout) return null;
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

function countTasks(tasksPath) {
  if (!existsSync(tasksPath)) return null;
  const text = readFileSync(tasksPath, 'utf8');
  const done = (text.match(/^\s*- \[x\]/gim) ?? []).length;
  const open = (text.match(/^\s*- \[ \]/gm) ?? []).length;
  return { done, total: done + open };
}

let current = null;
try {
  const statePath = join(cwd, '.my-flow', 'state', 'current-change.json');
  if (existsSync(statePath)) current = JSON.parse(readFileSync(statePath, 'utf8'));
} catch {
  current = null;
}

if (existsSync(specRoot)) {
  const changesDir = join(specRoot, 'changes');
  const changes = existsSync(changesDir)
    ? readdirSync(changesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== 'archive')
        .map((d) => d.name)
    : [];
  if (changes.length) {
    lines.push('Active OpenSpec changes (openspec/changes/):');
    for (const name of changes.slice(0, 8)) {
      const t = countTasks(join(changesDir, name, 'tasks.md'));
      const mark = current?.change === name ? ' <- current' : '';
      lines.push(`- ${name}: ${t ? `${t.done}/${t.total} tasks ticked` : 'no tasks.md yet'}${mark}`);
    }
    if (changes.length > 8) lines.push(`- ... ${changes.length - 8} more`);
  } else {
    lines.push('OpenSpec is initialised but there are no active changes.');
  }
  if (current?.change) {
    const status = runOpenspec(['status', '--change', current.change, '--json']);
    if (status?.artifacts) {
      const summary = status.artifacts.map((a) => `${a.id ?? a.name}: ${a.status}`).join(', ');
      lines.push(`Current change "${current.change}" (stage: ${current.stage ?? 'unknown'}) artifacts: ${summary}`);
    } else {
      lines.push(`Current change "${current.change}" (stage: ${current.stage ?? 'unknown'}).`);
    }
  }
  lines.push('Use the my-flow skills: interview -> plan -> run -> verify. tasks.md checkboxes are the only progress ledger.');
} else if (current?.change) {
  lines.push(`my-flow current change: "${current.change}" (stage: ${current.stage ?? 'unknown'}), simple mode (no openspec/).`);
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

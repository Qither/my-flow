#!/usr/bin/env node
/**
 * SessionStart hook (Claude Code + Codex): inject the active change status so a fresh
 * session knows where the previous one stopped, and print the pending model-routing summary
 * (scripts/lib/models.mjs). Pure file scan plus one detached spawn, no external tools.
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

/**
 * One shared view of who this session is and what it is bound to (contract C-06): a lease of its
 * own, the legacy pointer when nothing else could be meant, or nothing at all.
 *
 * Imported dynamically, like the model library below: a hook runs from an installed plugin cache
 * that may be older or half-updated, and a missing file must still leave the change status
 * printed and the exit code zero.
 */
const view = await (async () => {
  try {
    const { sessionView } = await import('./lib/intent-view.mjs');
    return await sessionView(cwd, input);
  } catch {
    let state = null;
    try {
      state = JSON.parse(read(join(cwd, '.my-flow', 'state', 'current-change.json')) ?? 'null');
    } catch {
      /* fail open */
    }
    return { degraded: true, binding: { change: state?.change ?? null, stage: state?.stage ?? null, source: 'legacy', ambiguous: false, reason: null } };
  }
})();
const current = view.binding.change ? { change: view.binding.change, stage: view.binding.stage } : null;

if (existsSync(changesDir)) {
  const changes = readdirSync(changesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'archive' && !d.name.startsWith('.') && !d.name.startsWith('_'))
    .map((d) => d.name)
    .sort();
  if (changes.length) {
    lines.push('Active changes (changes/<name>/):');
    for (const n of changes.slice(0, 8)) {
      const t = countTasks(join(changesDir, n, 'tasks.md'));
      const mark = current?.change === n ? ` <- current (stage: ${current.stage ?? 'unknown'}, ${view.binding.source === 'lease' ? 'this session' : 'legacy pointer'})` : '';
      lines.push(`- ${n}: ${t ? `${t.done}/${t.total} tasks ticked` : 'no tasks.md'}; ${artifacts(join(changesDir, n))}${mark}`);
    }
    if (changes.length > 8) lines.push(`- ... ${changes.length - 8} more`);
  } else {
    lines.push('changes/ exists but has no active change.');
  }
  if (view.binding.ambiguous) {
    lines.push(`Another session holds a live lease (${view.binding.reason}), and this session is unidentified, so nothing is marked current here. Run "spec session new" and pass --session to bind this one.`);
  }
  lines.push('Flow (my-flow skills): interview -> mf-plan -> execute -> mf-verify. tasks.md checkboxes are the only progress ledger; design.md Do-Not-Touch and Rebuild / Re-run sections are hard rules.');
} else if (current?.change) {
  lines.push(`Current change "${current.change}" (stage: ${current.stage ?? 'unknown'}), simple mode (docs/changes/).`);
}

// Model routing (subagent model override): one state read, at most one write, one detached
// spawn; never calls a model. Dynamic import inside the try so a missing or broken library
// (half-updated plugin cache, older checkout) still yields the change status and exit 0.
try {
  const { hookTick } = await import('../scripts/lib/models.mjs');
  lines.push(...hookTick({ pluginRoot: process.env.CLAUDE_PLUGIN_ROOT ?? null }).lines);
} catch {
  /* fail open */
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

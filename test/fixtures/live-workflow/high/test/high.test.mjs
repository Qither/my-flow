import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const invoke = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', windowsHide: true });
test('default text remains compatible', () => {
  const result = invoke();
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'Hello, fixture');
});
test('json flag exposes structured output', () => {
  const result = invoke('--json');
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), { greeting: 'Hello, fixture' });
});

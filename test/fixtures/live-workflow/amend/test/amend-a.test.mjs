import assert from 'node:assert/strict';
import { test } from 'node:test';
import { value } from '../source/a.mjs';
test('A is ready', () => assert.equal(value, 'A ready'));

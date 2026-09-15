import assert from 'node:assert/strict';
import { test } from 'node:test';
import { value } from '../source/b.mjs';
test('B is ready', () => assert.equal(value, 'B ready'));

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { value } from '../source/c.mjs';
test('C is ready', () => assert.equal(value, 'C ready'));

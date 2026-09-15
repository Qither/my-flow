import assert from 'node:assert/strict';
import { test } from 'node:test';
import { label as left } from '../source/left.mjs';
import { label as right } from '../source/right.mjs';
test('left label is ready', () => assert.equal(left, 'Left ready'));
test('right label is ready', () => assert.equal(right, 'Right ready'));

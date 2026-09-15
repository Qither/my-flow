import assert from 'node:assert/strict';
import { value } from '../source/a.mjs';
assert.equal(value, 'A ready');
console.log('A is ready');

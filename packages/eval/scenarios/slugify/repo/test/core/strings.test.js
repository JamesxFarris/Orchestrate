import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capitalize } from '../../src/core/strings.js';

test('capitalize', () => {
  assert.equal(capitalize('hello'), 'Hello');
  assert.equal(capitalize(''), '');
});

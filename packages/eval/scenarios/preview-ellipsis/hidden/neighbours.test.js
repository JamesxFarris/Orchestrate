import assert from 'node:assert/strict';
import { test } from 'node:test';
import { headline } from '../../src/core/report.js';
import { truncate } from '../../src/core/text.js';

// Only the preview was to change. These check the code that shares truncate() still behaves exactly as before.
test('dashboard headlines are still cut to 20 characters, with no ellipsis', () => {
  assert.equal(headline('  Quarterly revenue by region and channel  '), 'Quarterly revenue by');
  assert.equal(headline('Short title'), 'Short title');
});
test('truncate still returns the first len characters', () => {
  assert.equal(truncate('abcdef', 3), 'abc');
  assert.equal(truncate('ab', 3), 'ab');
});

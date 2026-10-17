import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mean, median } from '../../src/core/stats.js';

test('median: the reported case', () => assert.equal(median([10, 9, 2]), 9));
test('median: multi-digit numbers sort as numbers', () => assert.equal(median([100, 25, 3, 40, 7]), 25));
test('median: even count averages the middle two', () => assert.equal(median([10, 2, 30, 4]), 7));
test('median: negatives', () => assert.equal(median([-5, -10, 1]), -5));
test('median: does not reorder the input', () => {
  const xs = [3, 1, 2];
  median(xs);
  assert.deepEqual(xs, [3, 1, 2]);
});
test('mean still works', () => assert.equal(mean([2, 4]), 3));

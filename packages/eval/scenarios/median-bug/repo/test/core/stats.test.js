import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mean, median } from '../../src/core/stats.js';

test('mean', () => assert.equal(mean([1, 2, 3]), 2));
test('median of small numbers', () => assert.equal(median([3, 1, 2]), 2));

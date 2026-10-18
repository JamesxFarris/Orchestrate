import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDuration } from '../../src/core/duration.js';

test('seconds', () => assert.equal(parseDuration('90s'), 90));
test('minutes', () => assert.equal(parseDuration('5m'), 300));
test('hours', () => assert.equal(parseDuration('2h'), 7200));

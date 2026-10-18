import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDuration } from '../../src/core/duration.js';

test('the reported case: hours and minutes together', () => assert.equal(parseDuration('1h30m'), 5400));
test('all three units in order', () => assert.equal(parseDuration('2h5m10s'), 7510));
test('spaces between parts', () => assert.equal(parseDuration('1h 30m'), 5400));
test('units in either case', () => assert.equal(parseDuration('1H30M'), 5400));
test('a bare number is seconds', () => assert.equal(parseDuration('45'), 45));
test('single units still work', () => {
  assert.equal(parseDuration('90s'), 90);
  assert.equal(parseDuration('5m'), 300);
  assert.equal(parseDuration('2h'), 7200);
});
test('rejects empty text', () => assert.throws(() => parseDuration('')));
test('rejects an unknown unit', () => assert.throws(() => parseDuration('1x')));
test('rejects a unit with no number', () => assert.throws(() => parseDuration('h')));
test('rejects units out of order', () => assert.throws(() => parseDuration('30m1h')));
test('rejects a repeated unit', () => assert.throws(() => parseDuration('1h2h')));
test('rejects decimals and negatives', () => {
  assert.throws(() => parseDuration('1.5h'));
  assert.throws(() => parseDuration('-5m'));
});

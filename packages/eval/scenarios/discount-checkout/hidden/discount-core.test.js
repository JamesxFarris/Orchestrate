import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyDiscount, formatCents } from '../../src/core/money.js';

const DAY = '2026-03-15';

test('a percent code takes its share off', () => assert.deepEqual(applyDiscount(2000, 'SAVE10', DAY), { total: 1800, discount: 200 }));
test('percent discounts round half up to whole cents', () => assert.deepEqual(applyDiscount(1005, 'SAVE10', DAY), { total: 904, discount: 101 }));
test('codes match in any case', () => assert.deepEqual(applyDiscount(2000, 'save10', DAY), { total: 1800, discount: 200 }));
test('a code is valid on its expiry day', () => assert.deepEqual(applyDiscount(2000, 'SAVE10', '2026-12-31'), { total: 1800, discount: 200 }));
test('a code is expired the day after', () => assert.throws(() => applyDiscount(2000, 'SAVE10', '2027-01-01'), { message: 'expired' }));
test('another code expires on its own date', () => {
  assert.deepEqual(applyDiscount(1000, 'VIP25', '2026-06-30'), { total: 750, discount: 250 });
  assert.throws(() => applyDiscount(1000, 'VIP25', '2026-07-01'), { message: 'expired' });
});
test('a fixed code applies at its minimum', () => assert.deepEqual(applyDiscount(2000, 'FIVEOFF', DAY), { total: 1500, discount: 500 }));
test('a fixed code refuses an order below its minimum', () => assert.throws(() => applyDiscount(1999, 'FIVEOFF', DAY), { message: 'minimum not met' }));
test('a fixed discount never takes the total below zero', () => assert.deepEqual(applyDiscount(3000, 'BIGDEAL', DAY), { total: 0, discount: 3000 }));
test('an unknown code is refused', () => assert.throws(() => applyDiscount(2000, 'NOPE', DAY), { message: 'unknown code' }));
test('formatCents is unchanged', () => assert.equal(formatCents(1234), '$12.34'));

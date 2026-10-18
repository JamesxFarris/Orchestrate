import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handle } from '../../src/api/router.js';

const checkout = (query) => handle({ path: '/checkout', query });
const DAY = '2026-03-15';

test('GET /checkout answers the total and the discount', () => assert.deepEqual(checkout({ cents: '2000', code: 'SAVE10', today: DAY }), { status: 200, body: { total: 1800, discount: 200 } }));
test('a bad code answers 400 with the reason', () => {
  assert.deepEqual(checkout({ cents: '2000', code: 'NOPE', today: DAY }), { status: 400, body: { error: 'unknown code' } });
  assert.deepEqual(checkout({ cents: '2000', code: 'SAVE10', today: '2027-01-01' }), { status: 400, body: { error: 'expired' } });
  assert.deepEqual(checkout({ cents: '1999', code: 'FIVEOFF', today: DAY }), { status: 400, body: { error: 'minimum not met' } });
});
test('bad cents answers 400 bad request', () => {
  for (const cents of [undefined, 'ten', '12.5', '-1']) assert.deepEqual(checkout({ cents, code: 'SAVE10', today: DAY }), { status: 400, body: { error: 'bad request' } }, `cents ${cents}`);
});
test('a missing today answers 400 bad request', () => assert.deepEqual(checkout({ cents: '2000', code: 'SAVE10' }), { status: 400, body: { error: 'bad request' } }));
test('existing routes still work', () => assert.equal(handle({ path: '/health', query: {} }).status, 200));

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handle } from '../../src/api/router.js';

test('GET /tax answers the total', () => assert.deepEqual(handle({ path: '/tax', query: { cents: '1000', rate: '0.08' } }), { status: 200, body: { total: 1080 } }));
test('GET /tax rejects a missing value', () => assert.equal(handle({ path: '/tax', query: { cents: '1000' } }).status, 400));
test('GET /tax rejects a non-number', () => assert.equal(handle({ path: '/tax', query: { cents: 'ten', rate: '0.08' } }).status, 400));
test('GET /tax rejects negative cents', () => assert.equal(handle({ path: '/tax', query: { cents: '-5', rate: '0.08' } }).status, 400));
test('existing routes still work', () => assert.equal(handle({ path: '/health', query: {} }).status, 200));

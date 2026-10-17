import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handle } from '../../src/api/router.js';

test('health', () => assert.deepEqual(handle({ path: '/health', query: {} }), { status: 200, body: { ok: true } }));
test('unknown path', () => assert.equal(handle({ path: '/nope', query: {} }).status, 404));

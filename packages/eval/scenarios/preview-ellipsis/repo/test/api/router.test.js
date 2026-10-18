import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handle } from '../../src/api/router.js';

test('health', () => assert.deepEqual(handle({ path: '/health', query: {} }), { status: 200, body: { ok: true } }));
test('a short preview comes back whole', () => assert.deepEqual(handle({ path: '/preview', query: { text: 'hello', len: '10' } }), { status: 200, body: { preview: 'hello' } }));

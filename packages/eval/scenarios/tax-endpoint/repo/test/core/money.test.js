import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatCents } from '../../src/core/money.js';

test('formatCents', () => assert.equal(formatCents(1234), '$12.34'));

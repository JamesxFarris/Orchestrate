import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatCents } from '../../src/core/money.js';

test('formats cents as dollars', () => assert.equal(formatCents(1234), '$12.34'));

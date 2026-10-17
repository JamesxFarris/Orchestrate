import assert from 'node:assert/strict';
import { test } from 'node:test';
import { priceWithTax } from '../../src/core/money.js';

test('priceWithTax: whole cents', () => assert.equal(priceWithTax(1000, 0.08), 1080));
test('priceWithTax: rounds half up', () => assert.equal(priceWithTax(1005, 0.1), 1106)); // 1105.5 -> 1106
test('priceWithTax: rounds down below half', () => assert.equal(priceWithTax(999, 0.07), 1069)); // 1068.93 -> 1069
test('priceWithTax: zero rate', () => assert.equal(priceWithTax(500, 0), 500));
test('priceWithTax: returns an integer', () => assert.ok(Number.isInteger(priceWithTax(333, 0.0825))));

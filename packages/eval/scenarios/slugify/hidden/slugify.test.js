import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capitalize, slugify } from '../../src/core/strings.js';

test('slugify: the example from the request', () => assert.equal(slugify('  Hello, World!  '), 'hello-world'));
test('slugify: runs of separators become one hyphen', () => assert.equal(slugify('a -- b __ c'), 'a-b-c'));
test('slugify: digits are kept', () => assert.equal(slugify('Top 10 Tips'), 'top-10-tips'));
test('slugify: no leading or trailing hyphens', () => assert.equal(slugify('--Already-Slugged--'), 'already-slugged'));
test('slugify: nothing left gives an empty string', () => assert.equal(slugify('  !!  '), ''));
test('capitalize still works', () => assert.equal(capitalize('x'), 'X'));

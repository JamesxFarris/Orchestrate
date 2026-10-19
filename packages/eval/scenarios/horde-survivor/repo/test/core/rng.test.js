import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRng } from '../../src/core/rng.js';

test('the same seed gives the same numbers', () => {
  const a = createRng(42);
  const b = createRng(42);
  for (let i = 0; i < 5; i++) assert.equal(a.next(), b.next());
});

test('next is in [0, 1)', () => {
  const r = createRng(1);
  for (let i = 0; i < 100; i++) {
    const x = r.next();
    assert.ok(x >= 0 && x < 1);
  }
});

test('shuffle returns a permutation and leaves its input alone', () => {
  const items = ['a', 'b', 'c', 'd'];
  const out = createRng(3).shuffle(items);
  assert.deepEqual([...out].sort(), items);
  assert.deepEqual(items, ['a', 'b', 'c', 'd']);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRng } from '../../src/core/rng.js';

test('the numbers are unchanged: saving support must not alter the sequence', () => {
  const r = createRng(7);
  assert.deepEqual([r.next(), r.next(), r.next()], [0.011704753153026104, 0.06195825757458806, 0.97690763277933]);
  assert.deepEqual(createRng(7).shuffle(['damage', 'firerate', 'speed', 'vitality', 'magnet']), ['vitality', 'firerate', 'speed', 'magnet', 'damage']);
});

test('a generator resumed from its state continues the same sequence', () => {
  const a = createRng(99);
  for (let i = 0; i < 10; i++) a.next();
  const b = createRng(99, a.state());
  for (let i = 0; i < 5; i++) assert.equal(b.next(), a.next());
});

test('state survives a JSON round trip', () => {
  const a = createRng(5);
  a.next();
  const b = createRng(5, JSON.parse(JSON.stringify(a.state())));
  assert.equal(b.next(), a.next());
});

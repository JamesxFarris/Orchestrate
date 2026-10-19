import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRng } from '../../src/core/rng.js';
import { spawnWaves } from '../../src/sim/spawn.js';
import { createWorld } from '../../src/sim/world.js';

const at = (tick, seed = 7) => {
  const w = createWorld(seed);
  w.tick = tick;
  return w;
};
const close = (a, b) => Math.abs(a - b) < 1e-9;

test('nothing spawns between waves', () => {
  const w = at(59);
  spawnWaves(w);
  assert.equal(w.enemies.length, 0);
});

test('the first wave is three enemies with full hp and ids from 1', () => {
  const w = at(60);
  spawnWaves(w);
  assert.equal(w.enemies.length, 3);
  assert.deepEqual(w.enemies.map((e) => e.id), [1, 2, 3]);
  assert.ok(w.enemies.every((e) => e.hp === 10));
  assert.equal(w.nextId, 4);
});

test('waves grow by one every 300 ticks', () => {
  for (const [tick, n] of [[300, 4], [600, 5], [660, 5], [900, 6]]) {
    const w = at(tick);
    spawnWaves(w);
    assert.equal(w.enemies.length, n, `tick ${tick}`);
  }
});

test('enemies appear 40 away from the player, at angles drawn from the world rng in turn', () => {
  const w = at(60);
  w.player.x = 10;
  w.player.y = -5;
  spawnWaves(w);
  const r = createRng(7);
  for (const e of w.enemies) {
    const angle = r.next() * 2 * Math.PI;
    assert.ok(close(e.x, 10 + Math.cos(angle) * 40) && close(e.y, -5 + Math.sin(angle) * 40), `enemy ${e.id}`);
  }
});

test('ids keep counting across waves', () => {
  const w = at(60);
  spawnWaves(w);
  w.tick = 120;
  spawnWaves(w);
  assert.deepEqual(w.enemies.map((e) => e.id), [1, 2, 3, 4, 5, 6]);
});

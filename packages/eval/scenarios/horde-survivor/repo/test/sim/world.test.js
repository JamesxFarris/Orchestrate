import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld, step } from '../../src/sim/world.js';

test('a new world starts at tick 0 with a full-health player at the origin', () => {
  const w = createWorld(1);
  assert.equal(w.tick, 0);
  assert.deepEqual({ x: w.player.x, y: w.player.y, hp: w.player.hp }, { x: 0, y: 0, hp: 100 });
});

test('the player moves at its speed, diagonals normalised', () => {
  const w = createWorld(1);
  step(w, { dx: 1, dy: 0 });
  assert.deepEqual({ x: w.player.x, y: w.player.y }, { x: 2, y: 0 });
  step(w, { dx: 1, dy: 1 });
  assert.ok(Math.abs(w.player.x - (2 + Math.SQRT2)) < 1e-9);
  assert.equal(w.tick, 2);
});

test('a paused world does not advance', () => {
  const w = createWorld(1);
  w.paused = true;
  step(w, { dx: 1, dy: 0 });
  assert.equal(w.tick, 0);
});

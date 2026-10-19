import assert from 'node:assert/strict';
import { test } from 'node:test';
import { choose } from '../../src/sim/progression.js';
import { load, save, summary } from '../../src/sim/save.js';
import { createWorld, step } from '../../src/sim/world.js';

/**
 * The whole game, every system together: what the features add up to, and whether a later
 * feature broke an earlier one. Play is scripted: walk in a slow circle, take the first upgrade.
 */
const input = (tick) => ({ dx: Math.cos(tick / 40), dy: Math.sin(tick / 40) });

function play(world, untilTick) {
  while (world.tick < untilTick && !world.over) {
    if (world.paused) choose(world, world.choices[0]);
    else step(world, input(world.tick));
  }
  return world;
}

test('enemies arrive in waves and close in on the player', () => {
  const w = play(createWorld(7), 60);
  assert.ok(w.enemies.length >= 3, 'the first wave arrived');
  const before = Math.min(...w.enemies.map((e) => Math.hypot(e.x - w.player.x, e.y - w.player.y)));
  step(w, {});
  const after = Math.min(...w.enemies.map((e) => Math.hypot(e.x - w.player.x, e.y - w.player.y)));
  assert.ok(after < before);
});

test('the weapon kills enemies, kills drop gems, and gems level the player up', () => {
  const w = play(createWorld(7), 1200);
  assert.ok(w.kills >= 5, `kills: ${w.kills}`);
  assert.ok(w.level >= 2, `level: ${w.level}`);
});

test('a run left alone ends, and nothing moves after it ends', () => {
  const w = createWorld(7);
  while (!w.over && w.tick < 5000) {
    if (w.paused) choose(w, w.choices[0]);
    else step(w, {});
  }
  assert.equal(w.over, true, 'the horde wins eventually');
  const end = summary(w);
  assert.equal(end.hp, 0);
  step(w, {});
  assert.deepEqual(summary(w), end);
});

test('save and load in the middle of a run change nothing: the game is fully deterministic', () => {
  const straight = play(createWorld(21), 1200);
  const halfway = play(createWorld(21), 600);
  const resumed = play(load(save(halfway)), 1200);
  assert.equal(save(resumed), save(straight));
  assert.ok(straight.kills > 0 && straight.level > 1, 'the run was eventful enough to mean something');
});

test('the same seed and inputs always give the same game', () => {
  assert.equal(save(play(createWorld(5), 500)), save(play(createWorld(5), 500)));
});

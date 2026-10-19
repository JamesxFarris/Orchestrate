import assert from 'node:assert/strict';
import { test } from 'node:test';
import { load, save, summary } from '../../src/sim/save.js';
import { createWorld } from '../../src/sim/world.js';

test('the summary reports the run', () => {
  const w = createWorld(1);
  Object.assign(w, { tick: 120, kills: 4, level: 2, xp: 5, over: false });
  w.player.hp = 70;
  assert.deepEqual(summary(w), { tick: 120, kills: 4, level: 2, xp: 5, hp: 70, over: false });
});

test('save is JSON, and load gives back the same world', () => {
  const w = createWorld(3);
  w.rng.next();
  Object.assign(w, { tick: 7, kills: 1, xp: 2 });
  w.enemies.push({ id: 1, x: 1.5, y: -2.25, hp: 10 });
  const text = save(w);
  assert.equal(typeof text, 'string');
  JSON.parse(text);
  const back = load(text);
  assert.equal(save(back), text);
  assert.deepEqual(back.enemies, w.enemies);
  assert.deepEqual(back.player, w.player);
});

test('a loaded world draws the same random numbers as the original would', () => {
  const w = createWorld(11);
  w.rng.next();
  const back = load(save(w));
  for (let i = 0; i < 5; i++) assert.equal(back.rng.next(), w.rng.next());
});

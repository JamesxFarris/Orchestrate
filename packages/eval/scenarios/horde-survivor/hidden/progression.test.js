import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRng } from '../../src/core/rng.js';
import { UPGRADES } from '../../src/data/tables.js';
import { choose, collectGems, offerLevelUp } from '../../src/sim/progression.js';
import { createWorld, step } from '../../src/sim/world.js';

test('gems in reach are collected, gems out of reach stay', () => {
  const w = createWorld(1);
  w.gems = [{ x: 6, y: 0, xp: 1 }, { x: 0, y: 6.01, xp: 1 }];
  collectGems(w);
  assert.equal(w.xp, 1);
  assert.deepEqual(w.gems, [{ x: 0, y: 6.01, xp: 1 }]);
});

test('reaching a threshold levels up and queues a choice; a big haul can level up twice', () => {
  const w = createWorld(1);
  w.gems = [{ x: 0, y: 0, xp: 3 }];
  collectGems(w);
  assert.deepEqual([w.level, w.pendingLevelUps], [2, 1]);
  const big = createWorld(1);
  big.gems = [{ x: 0, y: 0, xp: 8 }];
  collectGems(big);
  assert.deepEqual([big.level, big.pendingLevelUps], [3, 2]);
});

test('levelling stops at the end of the table', () => {
  const w = createWorld(1);
  w.gems = [{ x: 0, y: 0, xp: 1000 }];
  collectGems(w);
  assert.equal(w.level, 6);
});

test('a pending level-up pauses the game and offers three upgrades from the world rng', () => {
  const w = createWorld(7);
  w.pendingLevelUps = 1;
  offerLevelUp(w);
  assert.equal(w.paused, true);
  assert.deepEqual(w.choices, createRng(7).shuffle(UPGRADES).slice(0, 3));
});

test('the game does not advance while a choice is waiting', () => {
  const w = createWorld(7);
  w.pendingLevelUps = 1;
  offerLevelUp(w);
  step(w, { dx: 1 });
  assert.equal(w.tick, 0);
});

test('each upgrade does what it says, on the world\'s stats', () => {
  const pick = (id) => {
    const w = createWorld(1);
    w.paused = true;
    w.pendingLevelUps = 1;
    w.choices = [id];
    w.player.hp = 50;
    choose(w, id);
    return w;
  };
  assert.equal(pick('damage').weapon.damage, 8);
  assert.equal(pick('firerate').weapon.cooldown, 16);
  assert.equal(pick('speed').player.speed, 2.5);
  assert.deepEqual([pick('vitality').player.maxHp, pick('vitality').player.hp], [120, 70]);
  assert.equal(pick('magnet').player.pickupRadius, 10);
});

test('fire rate never drops below 6', () => {
  const w = createWorld(1);
  w.weapon.cooldown = 8;
  w.paused = true;
  w.pendingLevelUps = 1;
  w.choices = ['firerate'];
  choose(w, 'firerate');
  assert.equal(w.weapon.cooldown, 6);
});

test('choosing something not on offer, or with nothing on offer, throws', () => {
  const w = createWorld(7);
  assert.throws(() => choose(w, 'damage'));
  w.pendingLevelUps = 1;
  offerLevelUp(w);
  const missing = UPGRADES.find((u) => !w.choices.includes(u));
  assert.throws(() => choose(w, missing));
});

test('with two level-ups pending, a choice is followed by a fresh offer, then play resumes', () => {
  const w = createWorld(7);
  w.pendingLevelUps = 2;
  offerLevelUp(w);
  const r = createRng(7);
  const first = r.shuffle(UPGRADES).slice(0, 3);
  choose(w, first[0]);
  assert.equal(w.paused, true);
  assert.deepEqual(w.choices, r.shuffle(UPGRADES).slice(0, 3));
  choose(w, w.choices[0]);
  assert.equal(w.paused, false);
  assert.equal(w.choices, null);
  assert.equal(w.pendingLevelUps, 0);
});

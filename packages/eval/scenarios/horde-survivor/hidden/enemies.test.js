import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contactDamage, moveEnemies, removeDead } from '../../src/sim/enemies.js';
import { createWorld } from '../../src/sim/world.js';

const world = (enemies) => {
  const w = createWorld(1);
  w.enemies = enemies;
  return w;
};

test('enemies step toward the player at their speed', () => {
  const w = world([{ id: 1, x: 10, y: 0, hp: 10 }, { id: 2, x: 0, y: -3, hp: 10 }]);
  moveEnemies(w);
  assert.deepEqual(w.enemies.map(({ x, y }) => ({ x, y })), [{ x: 9, y: 0 }, { x: 0, y: -2 }]);
});

test('an enemy closer than its speed lands on the player, and one already there stays', () => {
  const w = world([{ id: 1, x: 0.5, y: 0, hp: 10 }, { id: 2, x: 0, y: 0, hp: 10 }]);
  moveEnemies(w);
  assert.deepEqual(w.enemies.map(({ x, y }) => ({ x, y })), [{ x: 0, y: 0 }, { x: 0, y: 0 }]);
});

test('dead enemies are removed, counted, and leave a gem where they fell', () => {
  const w = world([{ id: 1, x: 5, y: 5, hp: 0 }, { id: 2, x: 1, y: 1, hp: 3 }, { id: 3, x: -2, y: 4, hp: -4 }]);
  removeDead(w);
  assert.deepEqual(w.enemies.map((e) => e.id), [2]);
  assert.equal(w.kills, 2);
  assert.deepEqual(w.gems, [{ x: 5, y: 5, xp: 1 }, { x: -2, y: 4, xp: 1 }]);
});

test('touching the player costs 10 hp once, however many enemies touch, then 30 ticks of safety', () => {
  const w = world([{ id: 1, x: 3, y: 0, hp: 10 }, { id: 2, x: 0, y: 4, hp: 10 }]);
  contactDamage(w);
  assert.equal(w.player.hp, 90);
  assert.equal(w.player.invulnerable, 30);
  contactDamage(w);
  assert.equal(w.player.hp, 90);
  assert.equal(w.player.invulnerable, 29);
});

test('an enemy out of reach does no damage', () => {
  const w = world([{ id: 1, x: 4.01, y: 0, hp: 10 }]);
  contactDamage(w);
  assert.equal(w.player.hp, 100);
  assert.equal(w.player.invulnerable, 0);
});

test('the run ends when hp reaches 0, and hp never goes below 0', () => {
  const w = world([{ id: 1, x: 1, y: 0, hp: 10 }]);
  w.player.hp = 5;
  contactDamage(w);
  assert.equal(w.player.hp, 0);
  assert.equal(w.over, true);
});

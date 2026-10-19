import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fireWeapon, moveBullets } from '../../src/sim/weapon.js';
import { createWorld } from '../../src/sim/world.js';

const world = (enemies) => {
  const w = createWorld(1);
  w.enemies = enemies;
  return w;
};

test('fires at an enemy in range: a bullet from the player toward it, then the cooldown', () => {
  const w = world([{ id: 1, x: 30, y: 0, hp: 10 }]);
  fireWeapon(w);
  assert.deepEqual(w.bullets, [{ x: 0, y: 0, vx: 6, vy: 0, ttl: 10 }]);
  assert.equal(w.weapon.timer, 20);
});

test('does not fire while cooling down, and counts the timer down', () => {
  const w = world([{ id: 1, x: 30, y: 0, hp: 10 }]);
  fireWeapon(w);
  fireWeapon(w);
  assert.equal(w.bullets.length, 1);
  assert.equal(w.weapon.timer, 19);
});

test('holds fire with nothing in range, and stays ready', () => {
  const w = world([{ id: 1, x: 61, y: 0, hp: 10 }]);
  fireWeapon(w);
  assert.equal(w.bullets.length, 0);
  assert.equal(w.weapon.timer, 0);
});

test('aims at the nearest enemy, the lowest id on a tie', () => {
  const near = world([{ id: 1, x: 0, y: 50, hp: 10 }, { id: 2, x: -20, y: 0, hp: 10 }]);
  fireWeapon(near);
  assert.deepEqual([near.bullets[0].vx, near.bullets[0].vy], [-6, 0]);
  const tie = world([{ id: 1, x: 0, y: 20, hp: 10 }, { id: 2, x: 20, y: 0, hp: 10 }]);
  fireWeapon(tie);
  assert.deepEqual([tie.bullets[0].vx, tie.bullets[0].vy], [0, 6]);
});

test('a bullet that reaches an enemy damages it and is gone', () => {
  const w = world([{ id: 1, x: 8, y: 0, hp: 10 }]);
  w.bullets = [{ x: 0, y: 0, vx: 6, vy: 0, ttl: 10 }];
  moveBullets(w);
  assert.equal(w.enemies[0].hp, 5);
  assert.deepEqual(w.bullets, []);
});

test('a bullet hits only the first enemy in id order', () => {
  const w = world([{ id: 1, x: 6, y: 1, hp: 10 }, { id: 2, x: 6, y: -1, hp: 10 }]);
  w.bullets = [{ x: 0, y: 0, vx: 6, vy: 0, ttl: 10 }];
  moveBullets(w);
  assert.deepEqual(w.enemies.map((e) => e.hp), [5, 10]);
});

test('a bullet that runs out of time is removed; one still flying keeps going', () => {
  const w = world([]);
  w.bullets = [{ x: 0, y: 0, vx: 6, vy: 0, ttl: 1 }, { x: 0, y: 0, vx: 0, vy: 6, ttl: 5 }];
  moveBullets(w);
  assert.deepEqual(w.bullets, [{ x: 0, y: 6, vx: 0, vy: 6, ttl: 4 }]);
});

test('upgraded damage and cooldown are the world\'s, not the table\'s', () => {
  const w = world([{ id: 1, x: 8, y: 0, hp: 20 }]);
  w.weapon.damage = 8;
  w.weapon.cooldown = 12;
  fireWeapon(w);
  assert.equal(w.weapon.timer, 12);
  moveBullets(w);
  assert.equal(w.enemies[0].hp, 12);
});

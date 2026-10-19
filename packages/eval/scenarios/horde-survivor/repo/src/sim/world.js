import { createRng } from '../core/rng.js';
import { PLAYER, WEAPON } from '../data/tables.js';
import { contactDamage, moveEnemies, removeDead } from './enemies.js';
import { collectGems, offerLevelUp } from './progression.js';
import { spawnWaves } from './spawn.js';
import { fireWeapon, moveBullets } from './weapon.js';

/** A new game. Player and weapon stats are copies of the tables, so upgrades never change the tables. */
export function createWorld(seed) {
  return {
    seed,
    tick: 0,
    rng: createRng(seed),
    nextId: 1,
    player: { x: 0, y: 0, hp: PLAYER.maxHp, maxHp: PLAYER.maxHp, speed: PLAYER.speed, radius: PLAYER.radius, pickupRadius: PLAYER.pickupRadius, invulnerable: 0 },
    weapon: { ...WEAPON, timer: 0 },
    enemies: [],
    bullets: [],
    gems: [],
    kills: 0,
    xp: 0,
    level: 1,
    pendingLevelUps: 0,
    paused: false,
    choices: null,
    over: false,
  };
}

/** Move the player by `input` ({ dx, dy }), normalised, at the player's speed. */
export function movePlayer(world, input) {
  const dx = input.dx ?? 0;
  const dy = input.dy ?? 0;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  world.player.x += (dx / len) * world.player.speed;
  world.player.y += (dy / len) * world.player.speed;
}

/** One fixed simulation tick. The system order is part of the spec (docs/spec.md). */
export function step(world, input = {}) {
  if (world.paused || world.over) return world;
  world.tick += 1;
  movePlayer(world, input);
  spawnWaves(world);
  moveEnemies(world);
  fireWeapon(world);
  moveBullets(world);
  removeDead(world);
  contactDamage(world);
  collectGems(world);
  offerLevelUp(world);
  return world;
}

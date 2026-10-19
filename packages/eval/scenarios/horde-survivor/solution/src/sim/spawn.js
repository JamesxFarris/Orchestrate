import { ENEMY, SPAWN } from '../data/tables.js';

/** Waves: see docs/spec.md, step 1. */
export function spawnWaves(world) {
  if (world.tick % SPAWN.every !== 0) return;
  const count = SPAWN.base + Math.floor(world.tick / SPAWN.growEvery);
  for (let i = 0; i < count; i++) {
    const angle = world.rng.next() * 2 * Math.PI;
    world.enemies.push({
      id: world.nextId++,
      x: world.player.x + Math.cos(angle) * SPAWN.radius,
      y: world.player.y + Math.sin(angle) * SPAWN.radius,
      hp: ENEMY.hp,
    });
  }
}

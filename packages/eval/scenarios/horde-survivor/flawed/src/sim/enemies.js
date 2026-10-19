import { dirTo, dist } from '../core/vec.js';
import { ENEMY, PLAYER } from '../data/tables.js';

/** Chase: see docs/spec.md, step 2. */
export function moveEnemies(world) {
  const p = world.player;
  for (const e of world.enemies) {
    const d = dist(e, p);
    if (d === 0) continue;
    const by = Math.min(ENEMY.speed, d);
    const dir = dirTo(e, p);
    e.x += dir.x * by;
    e.y += dir.y * by;
  }
}

/** Deaths: see docs/spec.md, step 5. */
export function removeDead(world) {
  const alive = [];
  for (const e of world.enemies) {
    if (e.hp > 0) alive.push(e);
    else {
      world.kills += 1;
      world.gems.push({ x: e.x, y: e.y, xp: ENEMY.xp });
    }
  }
  world.enemies = alive;
}

/** Contact: see docs/spec.md, step 6. */
export function contactDamage(world) {
  const p = world.player;
  if (p.invulnerable > 0) {
    p.invulnerable -= 1;
    return;
  }
  if (!world.enemies.some((e) => dist(e, p) <= ENEMY.radius + p.radius)) return;
  p.hp -= ENEMY.contactDamage;
  p.invulnerable = PLAYER.iFrames;
  if (p.hp <= 0) {
    p.hp = 0;
    world.over = true;
  }
}

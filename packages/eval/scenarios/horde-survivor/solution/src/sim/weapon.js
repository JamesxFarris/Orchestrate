import { dirTo, dist } from '../core/vec.js';
import { ENEMY } from '../data/tables.js';

/** Weapon: see docs/spec.md, step 3. */
export function fireWeapon(world) {
  const w = world.weapon;
  if (w.timer > 0) {
    w.timer -= 1;
    return;
  }
  const p = world.player;
  let target;
  for (const e of world.enemies) {
    const d = dist(e, p);
    // enemies are in id order, so a strict "<" keeps the lowest id on a tie
    if (d <= w.range && (!target || d < dist(target, p))) target = e;
  }
  if (!target) return;
  const dir = dirTo(p, target);
  world.bullets.push({ x: p.x, y: p.y, vx: dir.x * w.bulletSpeed, vy: dir.y * w.bulletSpeed, ttl: Math.ceil(w.range / w.bulletSpeed) });
  w.timer = w.cooldown;
}

/** Bullets: see docs/spec.md, step 4. */
export function moveBullets(world) {
  const w = world.weapon;
  const kept = [];
  for (const b of world.bullets) {
    b.x += b.vx;
    b.y += b.vy;
    b.ttl -= 1;
    const hit = world.enemies.find((e) => e.hp > 0 && dist(e, b) <= ENEMY.radius + w.bulletRadius);
    if (hit) hit.hp -= w.damage;
    else if (b.ttl > 0) kept.push(b);
  }
  world.bullets = kept;
}

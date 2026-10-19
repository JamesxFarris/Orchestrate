import { dist } from '../core/vec.js';
import { UPGRADES, XP_TO_LEVEL } from '../data/tables.js';

/** Gems: see docs/spec.md, step 7. */
export function collectGems(world) {
  const p = world.player;
  const left = [];
  for (const g of world.gems) {
    if (dist(g, p) <= p.pickupRadius) world.xp += g.xp;
    else left.push(g);
  }
  world.gems = left;
  while (world.level - 1 < XP_TO_LEVEL.length && world.xp >= XP_TO_LEVEL[world.level - 1]) {
    world.level += 1;
    world.pendingLevelUps += 1;
  }
}

const offer = (world) => world.rng.shuffle(UPGRADES).slice(0, 3);

/** Level-up offer: see docs/spec.md, step 8. */
export function offerLevelUp(world) {
  if (world.pendingLevelUps > 0 && !world.paused) {
    world.paused = true;
    world.choices = offer(world);
  }
}

const EFFECTS = {
  damage: (w) => (w.weapon.damage += 3),
  firerate: (w) => (w.weapon.cooldown = Math.max(6, w.weapon.cooldown - 4)),
  speed: (w) => (w.player.speed += 0.5),
  vitality: (w) => ((w.player.maxHp += 20), (w.player.hp += 20)),
  magnet: (w) => (w.player.pickupRadius += 4),
};

/** Choosing an upgrade: see docs/spec.md. */
export function choose(world, id) {
  if (!world.paused || !world.choices?.includes(id)) throw new Error(`"${id}" is not one of the choices on offer`);
  EFFECTS[id](world);
  world.pendingLevelUps -= 1;
  if (world.pendingLevelUps > 0) world.choices = offer(world);
  else {
    world.paused = false;
    world.choices = null;
  }
}

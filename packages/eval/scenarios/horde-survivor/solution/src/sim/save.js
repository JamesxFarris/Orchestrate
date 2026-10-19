import { createRng } from '../core/rng.js';

/** Summary, save and load: see docs/spec.md. */
export function summary(world) {
  return { tick: world.tick, kills: world.kills, level: world.level, xp: world.xp, hp: world.player.hp, over: world.over };
}

export function save(world) {
  return JSON.stringify({ ...world, rng: world.rng.state() });
}

export function load(text) {
  const data = JSON.parse(text);
  return { ...data, rng: createRng(data.seed, data.rng) };
}

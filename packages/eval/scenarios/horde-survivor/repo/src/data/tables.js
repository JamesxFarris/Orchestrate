/** Tuning tables. The world copies player and weapon stats at creation; upgrades change the copies. */

export const PLAYER = { speed: 2, maxHp: 100, radius: 2, pickupRadius: 6, iFrames: 30 };

export const ENEMY = { hp: 10, speed: 1, radius: 2, contactDamage: 10, xp: 1 };

/** A wave every `every` ticks: base + floor(tick / growEvery) enemies, `radius` from the player. */
export const SPAWN = { every: 60, base: 3, growEvery: 300, radius: 40 };

export const WEAPON = { cooldown: 20, damage: 5, bulletSpeed: 6, range: 60, bulletRadius: 1 };

/** Total xp needed to reach level 2, 3, 4, ... */
export const XP_TO_LEVEL = [3, 8, 15, 25, 40];

export const UPGRADES = ['damage', 'firerate', 'speed', 'vitality', 'magnet'];

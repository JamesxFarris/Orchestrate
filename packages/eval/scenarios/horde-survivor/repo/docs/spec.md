# Horde Survivor: simulation spec

A top-down wave-survival game, simulation only (no rendering). Everything is deterministic: the
same seed and the same inputs always give the same game. All numbers come from `src/data/tables.js`
(written below as `PLAYER.speed`, `ENEMY.hp` and so on); the world copies the player and weapon
stats at creation, and upgrades change the world's copies, never the tables.

## What already exists

- `src/core/rng.js`: `createRng(seed)`, a seeded generator with `next()` (a float in [0, 1)), `int(n)` and `shuffle(items)` (returns a shuffled copy).
- `src/core/vec.js`: small vector helpers.
- `src/sim/world.js`: `createWorld(seed)`, `step(world, input)` and player movement. `step` already calls every system below, in the order listed, once per tick. **Do not change the order or the world's shape**; implement the systems in their own modules.
- Stubs for every system in `src/sim/spawn.js`, `enemies.js`, `weapon.js`, `progression.js` and `save.js`.

## Shapes

- Enemy: `{ id, x, y, hp }`. Ids count up from 1 (`world.nextId` is the next one to hand out).
- Bullet: `{ x, y, vx, vy, ttl }`.
- Gem: `{ x, y, xp }`.

"Distance" is plain Euclidean distance. Lists keep insertion order (enemies are therefore in id order).

## One tick

`step(world, input)` does nothing while `world.paused` or `world.over`. Otherwise it adds 1 to
`world.tick`, moves the player, then runs, in this order:

1. **Waves** (`spawnWaves`, spawn.js). When `world.tick` is a multiple of `SPAWN.every`, spawn
   `SPAWN.base + Math.floor(world.tick / SPAWN.growEvery)` enemies. For each one, in turn: take
   `angle = world.rng.next() * 2 * Math.PI` and place it at `SPAWN.radius` from the player's current
   position in that direction (`x = player.x + Math.cos(angle) * SPAWN.radius`, likewise `y` with
   `Math.sin`), with `ENEMY.hp`, and the next id.
2. **Chase** (`moveEnemies`, enemies.js). Each enemy moves straight toward the player by
   `ENEMY.speed`, or exactly onto the player if it is closer than that. An enemy already on the
   player stays put.
3. **Weapon** (`fireWeapon`, weapon.js). If `world.weapon.timer` is above 0, lower it by 1 and stop.
   Otherwise find the nearest enemy within `world.weapon.range` (on a tie, the lowest id). If there
   is none, stop (the timer stays 0). If there is, add a bullet at the player's position, moving
   toward that enemy at `world.weapon.bulletSpeed` per tick (`vx`, `vy`), with
   `ttl = Math.ceil(world.weapon.range / world.weapon.bulletSpeed)`, and set the timer to
   `world.weapon.cooldown`.
4. **Bullets** (`moveBullets`, weapon.js). Each bullet, in order: move by `vx`, `vy`; lower `ttl` by 1;
   then the first enemy (lowest id) with `hp > 0` within `ENEMY.radius + world.weapon.bulletRadius` of
   the bullet loses `world.weapon.damage` hp and the bullet is removed. A bullet that hit nothing and
   has `ttl` 0 is removed.
5. **Deaths** (`removeDead`, enemies.js). Every enemy with `hp <= 0` is removed; each adds 1 to
   `world.kills` and leaves a gem `{ x, y, xp: ENEMY.xp }` where it died.
6. **Contact** (`contactDamage`, enemies.js). If `player.invulnerable` is above 0, lower it by 1 and
   stop. Otherwise, if any enemy is within `ENEMY.radius + player.radius` of the player, the player
   loses `ENEMY.contactDamage` hp (once, however many enemies touch) and `invulnerable` becomes
   `PLAYER.iFrames`. If hp falls to 0 or below, it is set to 0 and `world.over` becomes true.
7. **Gems** (`collectGems`, progression.js). Gems within `player.pickupRadius` of the player are
   removed and their xp added to `world.xp`. Then, while the next threshold exists and
   `world.xp >= XP_TO_LEVEL[world.level - 1]`, `world.level` and `world.pendingLevelUps` each go up by 1.
8. **Level-up offer** (`offerLevelUp`, progression.js). If `world.pendingLevelUps > 0` and the world
   is not already paused: `world.paused = true` and
   `world.choices = world.rng.shuffle(UPGRADES).slice(0, 3)`.

## Choosing an upgrade

`choose(world, id)` (progression.js) throws an Error if the world is not paused or `id` is not in
`world.choices`. Otherwise it applies the upgrade and lowers `pendingLevelUps` by 1. If more level-ups
are pending, it offers three new choices the same way (`world.rng.shuffle(UPGRADES).slice(0, 3)`) and
stays paused; if not, `paused` becomes false and `choices` becomes null.

| Upgrade | Effect |
|---|---|
| `damage` | `weapon.damage` + 3 |
| `firerate` | `weapon.cooldown` − 4, never below 6 |
| `speed` | `player.speed` + 0.5 |
| `vitality` | `player.maxHp` + 20 and `player.hp` + 20 |
| `magnet` | `player.pickupRadius` + 4 |

## Summary, save and load (save.js)

- `summary(world)` returns `{ tick, kills, level, xp, hp, over }` (`hp` is the player's).
- `save(world)` returns the whole world as a JSON string, including the random generator's position.
- `load(text)` returns a world that continues exactly as the saved one would have: stepping a loaded
  world gives the same results, tick for tick, as never having saved at all. The generator needs to be
  able to report its position and resume from one (`src/core/rng.js`: `rng.state()` and
  `createRng(seed, state)`), without changing the numbers it produces.

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** The unit vector from `from` toward `to`, or { x: 0, y: 0 } when they coincide. */
export function dirTo(from, to) {
  const d = dist(from, to);
  return d === 0 ? { x: 0, y: 0 } : { x: (to.x - from.x) / d, y: (to.y - from.y) / d };
}

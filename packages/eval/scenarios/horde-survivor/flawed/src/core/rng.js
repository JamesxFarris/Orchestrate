/**
 * A seeded random generator (mulberry32): the same seed always gives the same numbers.
 * `state()` reports its position; `createRng(seed, state)` resumes from one.
 */
export function createRng(seed, state) {
  let a = state ?? seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    /** A float in [0, 1). */
    next,
    /** A whole number in [0, n). */
    int: (n) => Math.floor(next() * n),
    /** A shuffled copy of `items` (Fisher-Yates). */
    shuffle(items) {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    /** Where the generator is, for saving. */
    state: () => a,
  };
}

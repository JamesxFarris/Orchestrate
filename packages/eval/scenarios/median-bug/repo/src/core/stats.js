/** Arithmetic mean; NaN for an empty list. */
export const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** The middle value (the mean of the two middle values for an even count). */
export function median(xs) {
  const sorted = [...xs].sort();
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

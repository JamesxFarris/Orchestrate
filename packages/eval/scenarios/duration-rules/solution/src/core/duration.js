/**
 * A duration in seconds: hours, minutes and seconds in that order, each at most once, optional
 * spaces between parts, units in either case ("1h 30m" -> 5400). A bare number is seconds.
 * Anything else throws.
 */
export function parseDuration(text) {
  const s = String(text).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const m = /^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/i.exec(s);
  if (!s || !m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) throw new Error(`not a duration: "${text}"`);
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** "90s" -> 90, "5m" -> 300, "2h" -> 7200: a duration in seconds. */
export function parseDuration(text) {
  const n = parseInt(text);
  if (text.endsWith('h')) return n * 3600;
  if (text.endsWith('m')) return n * 60;
  return n;
}

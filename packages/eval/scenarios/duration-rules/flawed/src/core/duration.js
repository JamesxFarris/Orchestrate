// FLAWED on purpose (eval self-check): handles combinations but validates nothing, so bad input slips through.
export function parseDuration(text) {
  let total = 0;
  for (const [, n, u] of String(text).matchAll(/(\d+)\s*([hms]?)/gi)) total += Number(n) * ({ h: 3600, m: 60 }[u.toLowerCase()] ?? 1);
  return total;
}

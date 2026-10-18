// FLAWED on purpose (eval self-check): expiry treated as exclusive, and percent discounts rounded down.
import { CODES } from './codes.js';
export const formatCents = (cents) => `$${(cents / 100).toFixed(2)}`;
export function applyDiscount(cents, code, today) {
  const c = CODES[String(code ?? '').toUpperCase()];
  if (!c) throw new Error('unknown code');
  if (c.expires && today >= c.expires) throw new Error('expired');
  if (c.minCents !== undefined && cents < c.minCents) throw new Error('minimum not met');
  const off = c.type === 'percent' ? Math.floor((cents * c.amount) / 100) : c.amount;
  const discount = Math.min(off, cents);
  return { total: cents - discount, discount };
}

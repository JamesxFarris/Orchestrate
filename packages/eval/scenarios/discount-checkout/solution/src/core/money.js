import { CODES } from './codes.js';

/** 1234 -> "$12.34" */
export const formatCents = (cents) => `$${(cents / 100).toFixed(2)}`;

/**
 * An order total after a discount code, in integer cents: { total, discount }. Throws
 * 'unknown code', 'expired' or 'minimum not met'. `today` is 'YYYY-MM-DD'; a code is valid
 * through its expiry day.
 */
export function applyDiscount(cents, code, today) {
  const c = CODES[String(code ?? '').toUpperCase()];
  if (!c) throw new Error('unknown code');
  if (c.expires && today > c.expires) throw new Error('expired');
  if (c.minCents !== undefined && cents < c.minCents) throw new Error('minimum not met');
  const off = c.type === 'percent' ? Math.round((cents * c.amount) / 100) : c.amount;
  const discount = Math.min(off, cents);
  return { total: cents - discount, discount };
}

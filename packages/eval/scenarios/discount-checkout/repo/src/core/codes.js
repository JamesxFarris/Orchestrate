/**
 * Discount codes, keyed in upper case.
 * percent: `amount` percent off the order. fixed: `amount` cents off.
 * expires: the last day the code is valid (inclusive), 'YYYY-MM-DD'; no expires means it never does.
 * minCents: the smallest order total it applies to.
 */
export const CODES = {
  SAVE10: { type: 'percent', amount: 10, expires: '2026-12-31' },
  VIP25: { type: 'percent', amount: 25, expires: '2026-06-30' },
  FIVEOFF: { type: 'fixed', amount: 500, minCents: 2000 },
  BIGDEAL: { type: 'fixed', amount: 5000 },
};

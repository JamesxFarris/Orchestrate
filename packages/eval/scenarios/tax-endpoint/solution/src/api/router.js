import { priceWithTax } from '../core/money.js';

/**
 * The API: a request is { path, query }, an answer is { status, body }.
 * Query values arrive as strings, as they would from a URL.
 */
export function handle(request) {
  if (request.path === '/health') return { status: 200, body: { ok: true } };
  if (request.path === '/tax') {
    const cents = Number(request.query.cents);
    const rate = Number(request.query.rate);
    const valid = request.query.cents !== undefined && request.query.rate !== undefined && Number.isFinite(cents) && Number.isFinite(rate) && cents >= 0 && rate >= 0;
    if (!valid) return { status: 400, body: { error: 'cents and rate must be non-negative numbers' } };
    return { status: 200, body: { total: priceWithTax(cents, rate) } };
  }
  return { status: 404, body: { error: 'not found' } };
}

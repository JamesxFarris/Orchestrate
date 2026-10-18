import { applyDiscount } from '../core/money.js';

/**
 * The API: a request is { path, query }, an answer is { status, body }.
 * Query values arrive as strings, as they would from a URL.
 */
export function handle(request) {
  if (request.path === '/health') return { status: 200, body: { ok: true } };
  if (request.path === '/checkout') {
    const { cents, code, today } = request.query;
    if (cents === undefined || !/^\d+$/.test(cents) || today === undefined) return { status: 400, body: { error: 'bad request' } };
    try {
      return { status: 200, body: applyDiscount(Number(cents), code, today) };
    } catch (err) {
      return { status: 400, body: { error: err.message } };
    }
  }
  return { status: 404, body: { error: 'not found' } };
}

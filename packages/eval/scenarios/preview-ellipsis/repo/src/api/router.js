import { truncate } from '../core/text.js';

/**
 * The API: a request is { path, query }, an answer is { status, body }.
 * Query values arrive as strings, as they would from a URL.
 */
export function handle(request) {
  if (request.path === '/health') return { status: 200, body: { ok: true } };
  if (request.path === '/preview') {
    const len = Number(request.query.len ?? 40);
    return { status: 200, body: { preview: truncate(request.query.text ?? '', len) } };
  }
  return { status: 404, body: { error: 'not found' } };
}

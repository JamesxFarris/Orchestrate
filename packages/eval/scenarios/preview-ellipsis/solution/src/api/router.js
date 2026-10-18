import { truncate } from '../core/text.js';

/**
 * The API: a request is { path, query }, an answer is { status, body }.
 * Query values arrive as strings, as they would from a URL.
 */
export function handle(request) {
  if (request.path === '/health') return { status: 200, body: { ok: true } };
  if (request.path === '/preview') {
    const len = Number(request.query.len ?? 40);
    if (!Number.isInteger(len) || len < 1) return { status: 400, body: { error: 'len must be a whole number of at least 1' } };
    const text = request.query.text ?? '';
    // cut text ends with an ellipsis, and the whole preview is exactly len characters
    const preview = text.length <= len ? text : `${truncate(text, len - 1)}…`;
    return { status: 200, body: { preview } };
  }
  return { status: 404, body: { error: 'not found' } };
}

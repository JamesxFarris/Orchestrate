// FLAWED on purpose (eval self-check): uses the changed shared truncate() from flawed/src/core/text.js.
import { truncate } from '../core/text.js';
export function handle(request) {
  if (request.path === '/health') return { status: 200, body: { ok: true } };
  if (request.path === '/preview') {
    const len = Number(request.query.len ?? 40);
    if (!Number.isInteger(len) || len < 1) return { status: 400, body: { error: 'bad len' } };
    return { status: 200, body: { preview: truncate(request.query.text ?? '', len) } };
  }
  return { status: 404, body: { error: 'not found' } };
}

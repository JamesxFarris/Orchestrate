/**
 * The API: a request is { path, query }, an answer is { status, body }.
 * Query values arrive as strings, as they would from a URL.
 */
export function handle(request) {
  if (request.path === '/health') return { status: 200, body: { ok: true } };
  return { status: 404, body: { error: 'not found' } };
}

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handle } from '../../src/api/router.js';

const preview = (query) => handle({ path: '/preview', query });

test('a cut preview ends with an ellipsis and is exactly len long', () => {
  const r = preview({ text: 'The quick brown fox jumps', len: '10' });
  assert.deepEqual(r, { status: 200, body: { preview: 'The quick…' } });
  assert.equal(r.body.preview.length, 10);
});
test('text no longer than len comes back unchanged', () => {
  assert.equal(preview({ text: 'hello', len: '10' }).body.preview, 'hello');
  assert.equal(preview({ text: 'exactly10!', len: '10' }).body.preview, 'exactly10!');
});
test('len defaults to 40', () => {
  const r = preview({ text: 'x'.repeat(50) });
  assert.equal(r.body.preview, `${'x'.repeat(39)}…`);
});
test('len of 1 is just the ellipsis', () => assert.equal(preview({ text: 'abc', len: '1' }).body.preview, '…'));
test('rejects a len that is not a whole number of at least 1', () => {
  for (const len of ['0', '-3', 'abc', '2.5']) assert.equal(preview({ text: 'abc', len }).status, 400, `len ${len}`);
});
test('existing routes still work', () => assert.equal(handle({ path: '/health', query: {} }).status, 200));

import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeState, decodeState } from '../src/export.js';

test('a payload survives the round trip, including non-ASCII labels', () => {
  const payload = { graph: 'flowchart LR\n a["Café ✓"] --> b', states: { a: 'success' }, n: 42 };
  assert.deepEqual(decodeState(encodeState(payload)), payload);
});

test('the encoding is URL-safe, so it can live in a hash', () => {
  const encoded = encodeState({ tricky: 'a/b+c=d?e#f' });
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
});

test('a leading # is tolerated, because that is how it arrives', () => {
  const encoded = encodeState({ ok: true });
  assert.deepEqual(decodeState(`#${encoded}`), { ok: true });
});

test('a mangled link decodes to null rather than throwing', () => {
  // A truncated or hand-edited URL should land on the default view, not an error page.
  assert.equal(decodeState('not base64 at all!!'), null);
  assert.equal(decodeState(''), null);
  assert.equal(decodeState(null), null);
  assert.equal(decodeState(encodeState({ a: 1 }).slice(0, 5)), null);
});

test('a large graph still encodes', () => {
  const nodes = {};
  for (let i = 0; i < 200; i++) nodes[`n${i}`] = { label: `Node ${i}` };
  const encoded = encodeState({ graph: { nodes } });
  assert.ok(encoded.length > 1000);
  assert.equal(Object.keys(decodeState(encoded).graph.nodes).length, 200);
});

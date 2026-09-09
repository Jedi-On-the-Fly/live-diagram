import test from 'node:test';
import assert from 'node:assert/strict';
import { StateStore, diffSnapshots } from '../src/state.js';

const store = () => new StateStore({ nodes: ['a', 'b'], defaultState: 'idle' });

test('every known node starts in the default state', () => {
  assert.deepEqual(store().snapshot().states, { a: 'idle', b: 'idle' });
});

test('the shorthand and the object form are the same patch', () => {
  const s = store();
  assert.deepEqual(s.apply({ a: 'running' }).changed, ['a']);
  assert.deepEqual(s.apply({ b: { state: 'running' } }).changed, ['b']);
  assert.deepEqual(s.snapshot().states, { a: 'running', b: 'running' });
});

test('a no-op patch reports no change — this is what stops needless renders', () => {
  const s = store();
  s.apply({ a: 'running' });
  const result = s.apply({ a: 'running' });
  assert.deepEqual(result.changed, []);
  assert.equal(result.structural, false);
});

test('a badge-only change is not structural', () => {
  const s = store();
  const result = s.apply({ a: { badge: '42s' } });
  assert.deepEqual(result.changed, ['a']);
  assert.equal(result.structural, false, 'a badge must not trigger a re-layout');
});

test('a state change is structural', () => {
  assert.equal(store().apply({ a: 'error' }).structural, true);
});

test('badges clear with null', () => {
  const s = store();
  s.apply({ a: { badge: '1s' } });
  assert.equal(s.get('a').badge, '1s');
  s.apply({ a: { badge: null } });
  assert.equal(s.get('a').badge, null);
});

test('data replaces by default and layers with merge', () => {
  const s = store();
  s.apply({ a: { data: { x: 1, y: 2 } } });
  s.apply({ a: { data: { y: 9 } } });
  assert.deepEqual(s.get('a').data, { y: 9 });
  s.apply({ a: { data: { x: 1 } , merge: true } });
  assert.deepEqual(s.get('a').data, { y: 9, x: 1 });
});

test('unknown nodes are reported, not thrown — a stream may know more than the graph', () => {
  const s = store();
  const result = s.apply({ ghost: 'running' });
  assert.deepEqual(result.unknown, ['ghost']);
  assert.deepEqual(result.changed, []);
});

test('strict mode throws on unknown nodes', () => {
  const s = new StateStore({ nodes: ['a'], strict: true });
  assert.throws(() => s.apply({ ghost: 'running' }), /unknown node "ghost"/);
});

test('snapshots are copies, not views', () => {
  const s = store();
  const snap = s.snapshot();
  s.apply({ a: 'error' });
  assert.equal(snap.states.a, 'idle');
});

test('reset restores a snapshot wholesale — the primitive behind seek', () => {
  const s = store();
  s.apply({ a: 'running', b: { state: 'success', badge: 'ok' } });
  const mark = s.snapshot();
  s.apply({ a: 'error', b: { badge: null } });
  s.reset(mark);
  assert.deepEqual(s.snapshot().states, mark.states);
  assert.equal(s.get('b').badge, 'ok');
});

test('setNodes keeps surviving state and drops the rest', () => {
  const s = store();
  s.apply({ a: 'success', b: 'error' });
  s.setNodes(['a', 'c']);
  assert.deepEqual(s.snapshot().states, { a: 'success', c: 'idle' });
});

test('diffSnapshots names what changed between two runs', () => {
  const a = { states: { x: 'success', y: 'success' } };
  const b = { states: { x: 'success', y: 'error' } };
  assert.deepEqual(diffSnapshots(a, b), [{ node: 'y', from: 'success', to: 'error' }]);
});

// ---- edges ----------------------------------------------------------------

const withEdges = () => new StateStore({ nodes: ['a', 'b'], edges: ['a->b'], defaultState: 'idle' });

test('edges start in the default state and are patched through the same door', () => {
  const s = withEdges();
  assert.equal(s.getEdge('a->b').state, 'idle');
  const result = s.apply({ 'a->b': 'running', a: 'running' });
  assert.deepEqual(result.edgesChanged, ['a->b']);
  assert.deepEqual(result.changed, ['a']);
  assert.equal(s.getEdge('a->b').state, 'running');
});

test('an edge snapshot is kept apart from the node snapshot', () => {
  const s = withEdges();
  s.apply({ 'a->b': 'error' });
  const snap = s.snapshot();
  assert.deepEqual(snap.states, { a: 'idle', b: 'idle' }, 'edges must not leak into node states');
  assert.deepEqual(snap.edges, { 'a->b': 'error' });
});

test('edges carry data and restore with the rest', () => {
  const s = withEdges();
  s.apply({ 'a->b': { state: 'running', data: { rps: 120 } } });
  const mark = s.snapshot();
  s.apply({ 'a->b': { state: 'idle', data: null } });
  assert.equal(s.getEdge('a->b').data, null);
  s.reset(mark);
  assert.deepEqual(s.getEdge('a->b'), { state: 'running', data: { rps: 120 } });
});

test('an unknown edge id is reported like an unknown node', () => {
  assert.deepEqual(withEdges().apply({ 'a->ghost': 'running' }).unknown, ['a->ghost']);
});

test('setEdges keeps what survives a graph swap', () => {
  const s = withEdges();
  s.apply({ 'a->b': 'success' });
  s.setEdges(['a->b', 'b->c']);
  assert.deepEqual(s.snapshot().edges, { 'a->b': 'success', 'b->c': 'idle' });
});

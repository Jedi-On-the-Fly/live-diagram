import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGraph, isValidId, escapeLabel, nodeIds } from '../src/graph.js';

test('normalizeGraph fills defaults and keeps declaration order', () => {
  const g = normalizeGraph({ nodes: { a: 'Alpha', b: { label: 'Beta', shape: 'diamond' } } });
  assert.equal(g.direction, 'TB');
  assert.equal(g.nodes.a.label, 'Alpha');
  assert.equal(g.nodes.a.shape, 'rect');
  assert.equal(g.nodes.b.shape, 'diamond');
  assert.deepEqual(nodeIds(g), ['a', 'b']);
});

test('normalizeGraph rejects an unknown direction by falling back, not throwing', () => {
  assert.equal(normalizeGraph({ direction: 'SIDEWAYS', nodes: { a: 'A' } }).direction, 'TB');
  assert.equal(normalizeGraph({ direction: 'LR', nodes: { a: 'A' } }).direction, 'LR');
});

test('normalizeGraph rejects ids that would need escaping in a definition', () => {
  assert.throws(() => normalizeGraph({ nodes: { 'a-b': 'x' } }), /Invalid node id/);
  assert.throws(() => normalizeGraph({ nodes: { '2fast': 'x' } }), /Invalid node id/);
  assert.throws(() => normalizeGraph({ nodes: { 'a b': 'x' } }), /Invalid node id/);
  assert.ok(isValidId('build_step_2'));
});

test('normalizeGraph rejects edges pointing at nodes that do not exist', () => {
  assert.throws(
    () => normalizeGraph({ nodes: { a: 'A' }, edges: [{ from: 'a', to: 'ghost' }] }),
    /unknown node "ghost"/
  );
});

test('normalizeGraph is frozen — the library never mutates your graph', () => {
  const input = { nodes: { a: 'A' }, edges: [] };
  const g = normalizeGraph(input);
  assert.throws(() => { g.nodes.b = {}; }, TypeError);
  assert.equal(Object.isFrozen(g), true);
  assert.deepEqual(input, { nodes: { a: 'A' }, edges: [] });
});

test('groups drop members that are not nodes rather than producing broken output', () => {
  const g = normalizeGraph({ nodes: { a: 'A', b: 'B' }, groups: [{ id: 'g1', label: 'CI', nodes: ['a', 'nope'] }] });
  assert.deepEqual(g.groups[0].nodes, ['a']);
});

test('escapeLabel neutralises quotes and newlines', () => {
  assert.equal(escapeLabel('say "hi"'), 'say &quot;hi&quot;');
  assert.equal(escapeLabel('two\nlines'), 'two<br/>lines');
  assert.equal(escapeLabel(null), '');
});

test('every edge gets an addressable id, and parallel edges stay distinct', () => {
  const g = normalizeGraph({ nodes: { a: 'A', b: 'B' }, edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'b' }] });
  assert.deepEqual(g.edges.map((e) => e.id), ['a->b', 'a->b#2']);
});

test('an explicit edge id is kept', () => {
  const g = normalizeGraph({ nodes: { a: 'A', b: 'B' }, edges: [{ id: 'retry', from: 'a', to: 'b' }] });
  assert.equal(g.edges[0].id, 'retry');
});

test('an edge id cannot collide with a node id', () => {
  const g = normalizeGraph('flowchart LR\n build-->test');
  assert.equal(g.edges[0].id, 'build->test');
  assert.equal(Object.keys(g.nodes).includes('build->test'), false);
});

test('the graph is frozen all the way down, except meta which stays yours', () => {
  const meta = { owner: 'me' };
  const g = normalizeGraph({
    nodes: { a: { label: 'A', meta }, b: 'B' },
    edges: [{ from: 'a', to: 'b' }],
    groups: [{ id: 'g', nodes: ['a'] }]
  });
  assert.throws(() => { g.nodes.a.label = 'mutated'; }, TypeError, 'node objects are frozen');
  assert.throws(() => { g.edges[0].to = 'a'; }, TypeError, 'edge objects are frozen');
  assert.throws(() => { g.groups[0].nodes.push('b'); }, TypeError, 'group member lists are frozen');
  g.nodes.a.meta.owner = 'still me';
  assert.equal(meta.owner, 'still me', 'meta is declared as the caller\'s and stays mutable');
});

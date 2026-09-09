import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGraph } from '../src/graph.js';
import { normalizeStates } from '../src/states.js';
import { buildDefinition, nodeSyntax } from '../src/renderers/mermaid-def.js';

const graph = normalizeGraph({
  direction: 'LR',
  nodes: {
    build: { label: 'Build', shape: 'rounded' },
    test: { label: 'Test' },
    deploy: { label: 'Deploy', shape: 'stadium' }
  },
  edges: [
    { from: 'build', to: 'test' },
    { from: 'test', to: 'deploy', condition: 'exit_0', label: 'green' }
  ]
});
const states = normalizeStates();
const build = (snapshot, options) => buildDefinition({ graph, snapshot, states, options: options || {} });

test('every shape has syntax and unknown shapes degrade to a box', () => {
  assert.equal(nodeSyntax('rounded', 'a', 'A'), 'a("A")');
  assert.equal(nodeSyntax('diamond', 'a', 'A'), 'a{"A"}');
  assert.equal(nodeSyntax('cylinder', 'a', 'A'), 'a[("A")]');
  assert.equal(nodeSyntax('unheard-of', 'a', 'A'), 'a["A"]');
});

test('the header carries the direction', () => {
  assert.match(build({ states: {} }), /^flowchart LR/);
});

test('an unconditional edge is solid and a conditional one is dotted', () => {
  const def = build({ states: {} });
  assert.match(def, /build --> test/);
  assert.match(def, /test -\.->\|green\| deploy/);
});

test('state drives the style line', () => {
  const def = build({ states: { build: 'success' } });
  assert.match(def, new RegExp(`style build ${states.success.style.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('the dark theme picks the dark palette', () => {
  const def = build({ states: { build: 'success' } }, { theme: 'dark' });
  assert.ok(def.includes(states.success.darkStyle));
  assert.ok(!def.includes(`style build ${states.success.style}`));
});

test('icons are opt-in and only then touch the label', () => {
  assert.match(build({ states: { build: 'running' } }), /build\("Build"\)/);
  assert.match(build({ states: { build: 'running' } }, { showIcons: true }), /build\("▶ Build"\)/);
});

test('nodes with no state get the default state style', () => {
  const def = build({ states: {} });
  assert.ok(def.includes(`style test ${states.idle.style}`));
});

test('groups render as subgraphs and their nodes are declared once', () => {
  const grouped = normalizeGraph({
    nodes: { a: 'A', b: 'B', c: 'C' },
    edges: [{ from: 'a', to: 'b' }],
    groups: [{ id: 'ci', label: 'CI', nodes: ['a', 'b'] }]
  });
  const def = buildDefinition({ graph: grouped, snapshot: { states: {} }, states, options: {} });
  assert.match(def, /subgraph ci \["CI"\]/);
  assert.equal((def.match(/^\s*a\["A"\]/gm) || []).length, 1, 'a grouped node is declared exactly once');
  assert.match(def, /^\s{2}c\["C"\]/m, 'an ungrouped node stays at the top level');
});

test('subgraph boxes get a neutral style per theme, overridable', () => {
  const grouped = normalizeGraph({ nodes: { a: 'A' }, groups: [{ id: 'ci', label: 'CI', nodes: ['a'] }] });
  const light = buildDefinition({ graph: grouped, snapshot: { states: {} }, states, options: {} });
  const dark = buildDefinition({ graph: grouped, snapshot: { states: {} }, states, options: { theme: 'dark' } });
  assert.match(light, /style ci fill:#f8fafc/);
  assert.match(dark, /style ci fill:#0f172a/);
  const off = buildDefinition({ graph: grouped, snapshot: { states: {} }, states, options: { groupStyle: '' } });
  assert.equal(/style ci /.test(off), false, 'an empty groupStyle opts out');
});

test('labels with quotes cannot break out of the definition', () => {
  const risky = normalizeGraph({ nodes: { a: { label: 'say "hi" ["x"]' } } });
  const def = buildDefinition({ graph: risky, snapshot: { states: {} }, states, options: {} });
  assert.ok(!/"hi"/.test(def), 'raw quotes must not survive');
  assert.match(def, /&quot;hi&quot;/);
});

test('the definition is deterministic for the same inputs', () => {
  assert.equal(build({ states: { build: 'running' } }), build({ states: { build: 'running' } }));
});

test('an edge in a non-default state emits a linkStyle at its own index', () => {
  const g = normalizeGraph('flowchart LR\n a-->b-->c');
  const def = buildDefinition({
    graph: g, states,
    snapshot: { states: {}, edges: { 'b->c': 'error' } },
    options: {}
  });
  assert.match(def, /linkStyle 1 stroke:#dc2626/);
  assert.equal(/linkStyle 0 /.test(def), false, 'an idle edge stays unstyled');
  assert.ok(def.indexOf('linkStyle') > def.indexOf('a --> b'), 'linkStyle comes after the edges it addresses');
});

test('edge styles follow the theme like node styles do', () => {
  const g = normalizeGraph('flowchart LR\n a-->b');
  const dark = buildDefinition({ graph: g, states, snapshot: { states: {}, edges: { 'a->b': 'success' } }, options: { theme: 'dark' } });
  assert.match(dark, /linkStyle 0 stroke:#4ade80/);
});

test('an empty label emits something Mermaid can parse', () => {
  const g = normalizeGraph({ nodes: { dot: { label: '', shape: 'circle' }, a: 'A' }, edges: [{ from: 'dot', to: 'a' }] });
  const def = buildDefinition({ graph: g, snapshot: { states: {} }, states, options: {} });
  // `dot((""))` is a Mermaid syntax error; a space parses and draws nothing.
  assert.equal(def.includes('dot((""))'), false);
  assert.match(def, /dot\(\(" "\)\)/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStateDiagram } from '../src/parse-state.js';
import { parseMermaid } from '../src/parse-mermaid.js';
import { normalizeGraph } from '../src/graph.js';

const parse = (src) => parseStateDiagram(src);
const link = (g) => g.edges.map((e) => `${e.from}->${e.to}${e.label ? `[${e.label}]` : ''}`);

test('parseMermaid dispatches a state diagram to the state parser', () => {
  const g = parseMermaid('stateDiagram-v2\n [*] --> Idle');
  assert.deepEqual(Object.keys(g.nodes), ['start', 'Idle']);
  assert.doesNotThrow(() => parseMermaid('stateDiagram\n [*] --> A'), 'the v1 header works too');
});

test('[*] becomes a start when it is the source and a stop when it is the target', () => {
  const g = parse('stateDiagram-v2\n [*] --> A\n A --> [*]');
  assert.equal(g.nodes.start.shape, 'circle');
  assert.equal(g.nodes.start.label, '');
  assert.equal(g.nodes.stop.meta.terminal, 'stop');
  assert.deepEqual(link(g), ['start->A', 'A->stop']);
});

test('several [*] on the same side share one terminal', () => {
  const g = parse('stateDiagram-v2\n A --> [*]\n B --> [*]');
  assert.equal(Object.keys(g.nodes).filter((id) => id.includes('stop')).length, 1);
});

test('transition labels come after the colon', () => {
  assert.deepEqual(link(parse('stateDiagram-v2\n A --> B : go ahead')), ['A->B[go ahead]']);
});

test('states default to rounded, and direction is read from the header block', () => {
  const g = parse('stateDiagram-v2\n direction LR\n A --> B');
  assert.equal(g.direction, 'LR');
  assert.equal(g.nodes.A.shape, 'rounded');
});

test('an alias sets the label, whichever order it is written in', () => {
  const before = parse('stateDiagram-v2\n state "Waiting for input" as Idle\n Idle --> Busy');
  const after = parse('stateDiagram-v2\n Idle --> Busy\n state "Waiting for input" as Idle');
  assert.equal(before.nodes.Idle.label, 'Waiting for input');
  assert.equal(after.nodes.Idle.label, 'Waiting for input');
});

test('a colon line becomes the description, not a transition', () => {
  const g = parse('stateDiagram-v2\n A --> B\n A : does the work');
  assert.equal(g.nodes.A.description, 'does the work');
  assert.equal(g.edges.length, 1);
});

test('choice, fork and join markers get shapes', () => {
  const g = parse(`stateDiagram-v2
    state pick <<choice>>
    state split <<fork>>
    state merge <<join>>
    a --> pick`);
  assert.equal(g.nodes.pick.shape, 'diamond');
  assert.equal(g.nodes.split.shape, 'rect');
  assert.equal(g.nodes.split.label, '', 'a fork bar has no text of its own');
  assert.equal(g.nodes.merge.meta.kind, 'join');
});

test('a composite state becomes a group with its own start and stop', () => {
  const g = parse(`stateDiagram-v2
    [*] --> Deploy
    state Deploy {
      [*] --> canary
      canary --> full
      full --> [*]
    }`);
  assert.deepEqual(g.groups.map((x) => x.id), ['Deploy']);
  assert.deepEqual(g.groups[0].nodes, ['Deploy_start', 'canary', 'full', 'Deploy_stop']);
  assert.equal(g.nodes.Deploy, undefined, 'the container is not also a node');
  assert.equal(g.nodes.Deploy_start.meta.scope, 'Deploy', 'its terminals belong to it, not to the diagram');
});

test('a transition naming a composite is redirected to its start or stop', () => {
  const g = parse(`stateDiagram-v2
    Ready --> Deploy
    Deploy --> Done
    state Deploy {
      [*] --> canary
      canary --> [*]
    }`);
  assert.ok(link(g).includes('Ready->Deploy_start'), 'entering a composite enters its start');
  assert.ok(link(g).includes('Deploy_stop->Done'), 'leaving one leaves its stop');
  assert.equal(link(g).some((l) => l.includes('->Deploy') && !l.includes('Deploy_')), false);
});

test('a composite with no terminals of its own still resolves to real nodes', () => {
  const g = parse(`stateDiagram-v2
    Ready --> Group
    state Group {
      one --> two
    }
    Group --> Done`);
  assert.ok(link(g).includes('Ready->one'));
  assert.ok(link(g).includes('two->Done'));
});

test('nested composites nest', () => {
  const g = parse(`stateDiagram-v2
    state Outer {
      a --> b
      state Inner {
        c --> d
      }
    }`);
  assert.deepEqual(g.groups.map((x) => x.id).sort(), ['Inner', 'Outer']);
  assert.ok(g.groups.find((x) => x.id === 'Inner').nodes.includes('c'));
});

test('notes are read and discarded, in both forms', () => {
  const g = parse(`stateDiagram-v2
    A --> B
    note right of A : this is an aside
    note left of B
      several
      lines
    end note
    B --> C`);
  assert.deepEqual(Object.keys(g.nodes), ['A', 'B', 'C']);
  assert.equal(g.edges.length, 2);
});

test('styling directives are ignored, and strict mode says so', () => {
  assert.doesNotThrow(() => parse('stateDiagram-v2\n A --> B\n classDef big font-size:20px'));
  assert.throws(() => parseStateDiagram('stateDiagram-v2\n A --> B\n classDef big x:1', { strict: true }), /unsupported directive/);
});

test('the concurrency divider is not a transition', () => {
  const g = parse(`stateDiagram-v2
    state Both {
      a --> b
      --
      c --> d
    }`);
  assert.equal(g.edges.length, 2);
});

test('ids Mermaid allows are rewritten, consistently across a diagram', () => {
  const g = parse('stateDiagram-v2\n my-state --> other.state\n other.state --> my-state');
  assert.deepEqual(Object.keys(g.nodes), ['my_state', 'other_state']);
  assert.deepEqual(link(g), ['my_state->other_state', 'other_state->my_state']);
});

test('an empty diagram says so', () => {
  assert.throws(() => parse('stateDiagram-v2'), /no states found/);
  assert.throws(() => parse(''), /empty state diagram/);
});

test('the result is a graph the library accepts unchanged', () => {
  const g = normalizeGraph(parse(`stateDiagram-v2
    direction LR
    [*] --> Idle
    Idle --> Running : start
    Running --> Idle : stop
    Running --> [*]
    state Running {
      [*] --> working
      working --> [*]
    }`));
  assert.equal(g.direction, 'LR');
  assert.ok(g.edges.every((e) => g.nodes[e.from] && g.nodes[e.to]), 'every edge lands on a real node');
  assert.equal(g.groups[0].id, 'Running');
});

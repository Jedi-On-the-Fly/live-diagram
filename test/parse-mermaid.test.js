import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMermaid, looksLikeMermaid } from '../src/parse-mermaid.js';
import { normalizeGraph } from '../src/graph.js';

const parse = (src) => parseMermaid(src);
const ids = (g) => Object.keys(g.nodes);
const link = (g) => g.edges.map((e) => `${e.from}${e.condition === 'dotted' ? '-.' : '-'}${e.label ? `|${e.label}|` : ''}>${e.to}`);

test('the header sets the direction, and its absence defaults to TB', () => {
  assert.equal(parse('flowchart LR\n a-->b').direction, 'LR');
  assert.equal(parse('graph TD\n a-->b').direction, 'TD');
  assert.equal(parse('flowchart\n a-->b').direction, 'TB');
  assert.equal(parse('a-->b').direction, 'TB', 'a headerless snippet still parses');
});

test('every flowchart shape maps to one of ours', () => {
  const g = parse(`flowchart TB
    a[rect] --> b(rounded) --> c([stadium]) --> d{diamond}
    d --> e((circle)) --> f{{hex}} --> h[[sub]] --> i[(db)]`);
  assert.deepEqual(Object.values(g.nodes).map((n) => n.shape),
    ['rect', 'rounded', 'stadium', 'diamond', 'circle', 'hex', 'subroutine', 'cylinder']);
  assert.equal(g.nodes.c.label, 'stadium');
});

test('quoted labels keep their punctuation', () => {
  const g = parse('flowchart LR\n a["Build & sign (v2)"] --> b["It said \\"no\\""]');
  assert.equal(g.nodes.a.label, 'Build & sign (v2)');
  assert.match(g.nodes.b.label, /said/);
});

test('every edge form is recognised', () => {
  const g = parse(`flowchart LR
    a --> b
    b --- c
    c -.-> d
    d -.- e
    e ==> f
    f --o g
    g --x h`);
  assert.equal(g.edges.length, 7);
  assert.deepEqual(g.edges.map((e) => e.condition),
    ['always', 'always', 'dotted', 'dotted', 'always', 'always', 'always']);
});

test('edge labels are read from both the pipe form and the inline form', () => {
  const g = parse(`flowchart LR
    a -->|yes| b
    b -- no --> c
    c -. retry .-> d
    d == fast ==> e`);
  assert.deepEqual(g.edges.map((e) => e.label), ['yes', 'no', 'retry', 'fast']);
  assert.equal(g.edges[2].condition, 'dotted');
});

test('chains become one edge per hop', () => {
  assert.deepEqual(link(parse('flowchart LR\n a --> b --> c --> d')), ['a->b', 'b->c', 'c->d']);
});

test('& expands to the cross product, on either side', () => {
  assert.deepEqual(link(parse('flowchart LR\n a & b --> c')), ['a->c', 'b->c']);
  assert.deepEqual(link(parse('flowchart LR\n a --> b & c')), ['a->b', 'a->c']);
  assert.deepEqual(link(parse('flowchart LR\n a & b --> c & d')).sort(), ['a->c', 'a->d', 'b->c', 'b->d']);
});

test('a node can be declared inline in an edge, or on its own line', () => {
  const g = parse(`flowchart LR
    build[Build] --> test
    test["Run the tests"]`);
  assert.equal(g.nodes.build.label, 'Build');
  assert.equal(g.nodes.test.label, 'Run the tests', 'a later, richer declaration wins');
});

test('subgraphs become groups, titled and named', () => {
  const g = parse(`flowchart TB
    subgraph ci [Continuous integration]
      lint --> unit
    end
    subgraph "Deploy"
      ship
    end
    unit --> ship`);
  assert.deepEqual(g.groups.map((x) => [x.id, x.label, x.nodes.join('+')]),
    [['ci', 'Continuous integration', 'lint+unit'], ['Deploy', 'Deploy', 'ship']]);
});

test('an empty subgraph is dropped rather than rendered as a lonely box', () => {
  assert.deepEqual(parse('flowchart LR\n subgraph empty\n end\n a-->b').groups, []);
});

test('ids Mermaid allows but this library cannot are rewritten consistently', () => {
  const g = parse('flowchart LR\n my-node["Mine"] --> 2fast --> my-node');
  assert.deepEqual(ids(g), ['my_node', 'n2fast']);
  assert.deepEqual(link(g), ['my_node->n2fast', 'n2fast->my_node'], 'both ends follow the rewrite');
  assert.equal(g.nodes.my_node.meta.mermaidId, 'my-node', 'and the original is kept');
  assert.doesNotThrow(() => normalizeGraph(g));
});

test('two different ids that sanitise the same stay two nodes', () => {
  const g = parse('flowchart LR\n a.b --> a-b');
  assert.equal(ids(g).length, 2);
  assert.deepEqual(ids(g), ['a_b', 'a_b_2']);
});

test('comments and directives are ignored, not fatal', () => {
  const g = parse(`%%{init: {'theme':'dark'}}%%
    flowchart LR
    %% this is a note
    a --> b   %% trailing note
    style a fill:#f00
    classDef big font-size:20px
    class a big
    click a "https://example.com"
    linkStyle 0 stroke:#0f0`);
  assert.deepEqual(ids(g), ['a', 'b']);
  assert.equal(g.edges.length, 1);
});

test('strict mode complains about the directives it drops', () => {
  assert.throws(() => parseMermaid('flowchart LR\n a-->b\n style a fill:#f00', { strict: true }), /unsupported directive "style"/);
});

test('a %% inside a quoted label is not a comment', () => {
  assert.equal(parse('flowchart LR\n a["100%% done"] --> b').nodes.a.label, '100%% done');
});

test('semicolons separate statements', () => {
  assert.deepEqual(link(parse('flowchart LR; a-->b; b-->c;')), ['a->b', 'b->c']);
});

test('another diagram type is refused by name, not by silence', () => {
  assert.throws(() => parse('sequenceDiagram\n Alice->>Bob: hi'), /this is a sequenceDiagram/);
  assert.throws(() => parse('pie title Pets\n "Dogs": 386'), /pie/);
  assert.throws(() => parse('classDiagram\n Animal <|-- Duck'), /classDiagram/);
});

test('a state diagram is not refused — it is dispatched to the state parser', () => {
  const g = parse('stateDiagram-v2\n [*] --> Still\n Still --> [*]');
  assert.deepEqual(Object.keys(g.nodes), ['start', 'Still', 'stop']);
});

test('input with nothing in it says so', () => {
  assert.throws(() => parse(''), /empty Mermaid source/);
  assert.throws(() => parse('flowchart LR'), /no nodes found/);
});

test('a node id with spaces gets a message that says how to fix it', () => {
  assert.throws(() => parse('flowchart LR\n my node --> b'), /write it as id\["my node"\]/);
});

test('the result is a graph the library accepts unchanged', () => {
  const g = normalizeGraph(parse(`flowchart LR
    A[Start] --> B{Decide}
    B -- yes --> C(Ship)
    B -- no --> D[[Rework]]
    C & D --> E((Done))`));
  assert.equal(Object.keys(g.nodes).length, 5);
  assert.equal(g.edges.length, 5);
  assert.equal(g.nodes.E.shape, 'circle');
});

test('normalizeGraph takes Mermaid source directly', () => {
  const g = normalizeGraph('flowchart LR\n build --> test');
  assert.deepEqual(Object.keys(g.nodes), ['build', 'test']);
});

test('looksLikeMermaid tells source from JSON', () => {
  assert.equal(looksLikeMermaid('flowchart LR\n a-->b'), true);
  assert.equal(looksLikeMermaid('a --> b'), true);
  assert.equal(looksLikeMermaid('{"nodes":{}}'), false);
  assert.equal(looksLikeMermaid('  { "graph": {} }'), false);
  assert.equal(looksLikeMermaid(''), false);
});

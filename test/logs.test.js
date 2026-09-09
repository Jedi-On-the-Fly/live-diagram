import test from 'node:test';
import assert from 'node:assert/strict';
import { toTimelineEvents, graphFromEvents } from '../src/adapters/logs.js';
import { normalizeGraph } from '../src/graph.js';
import { normalizeEvents } from '../src/timeline.js';

const ROWS = [
  { timestamp: 100, nodeId: 'extract', status: 'running' },
  { timestamp: 100, nodeId: 'extract', level: 'info', line: 'connecting…' },
  { timestamp: 900, nodeId: 'extract', status: 'success', ms: 800 },
  { timestamp: 950, nodeId: 'transform', status: 'running' },
  { timestamp: 2100, nodeId: 'transform', status: 'error', ms: 1150 }
];

test('rows that are not state changes are dropped', () => {
  const events = toTimelineEvents(ROWS);
  assert.equal(events.length, 4, 'the log line is not an event');
  assert.deepEqual(events[0], { t: 100, node: 'extract', state: 'running' });
});

test('badges and data are opt-in, per row', () => {
  const events = toTimelineEvents(ROWS, {
    badge: (row) => (row.ms ? `${(row.ms / 1000).toFixed(1)}s` : undefined),
    data: (row) => (row.ms ? { ms: row.ms } : undefined)
  });
  assert.equal(events[0].badge, undefined, 'a row with no duration gets no badge key at all');
  assert.equal(events[1].badge, '0.8s');
  assert.deepEqual(events[1].data, { ms: 800 });
});

test('field names are configurable, and so are accessors', () => {
  const rows = [{ at: 5, step: 'build', phase: 'error', meta: { attempt: 2 } }];
  assert.deepEqual(
    toTimelineEvents(rows, { time: 'at', node: 'step', state: 'phase', data: (r) => r.meta }),
    [{ t: 5, node: 'build', state: 'error', data: { attempt: 2 } }]
  );
});

test('a missing or unparseable timestamp becomes 0 rather than NaN', () => {
  const events = toTimelineEvents([{ nodeId: 'a', status: 'running' }]);
  assert.equal(events[0].t, 0);
  assert.equal(normalizeEvents(events).duration, 0);
});

test('the events it produces are accepted by the timeline unchanged', () => {
  const { events, duration } = normalizeEvents(toTimelineEvents(ROWS));
  assert.equal(duration, 2000);
  assert.deepEqual(events[0].patch, { extract: { state: 'running' } });
});

test('a graph can be recovered from the log when there is no declared structure', () => {
  const graph = normalizeGraph(graphFromEvents(toTimelineEvents(ROWS)));
  assert.deepEqual(Object.keys(graph.nodes), ['extract', 'transform']);
  assert.deepEqual(graph.edges.map((e) => `${e.from}->${e.to}`), ['extract->transform']);
});

test('chain:false gives the nodes without guessing at edges', () => {
  const graph = graphFromEvents(toTimelineEvents(ROWS), { chain: false });
  assert.deepEqual(graph.edges, []);
});

test('an empty log produces an empty graph rather than throwing', () => {
  assert.deepEqual(toTimelineEvents(null), []);
  assert.deepEqual(graphFromEvents([]).nodes, {});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromGitHubActions, toStages, linkStages, stateOf, toId, GITHUB_STATES } from '../src/adapters/github-actions.js';
import { normalizeGraph } from '../src/graph.js';
import { normalizeStates } from '../src/states.js';
import { Timeline } from '../src/timeline.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN = JSON.parse(fs.readFileSync(path.join(ROOT, 'demo', 'data', 'github-run.json'), 'utf8'));

test('job names become ids a diagram can actually use', () => {
  assert.equal(toId('test (node 22)'), 'test_node_22');
  assert.equal(toId('build & sign'), 'build_sign');
  assert.equal(toId('2fa-check'), 'j2fa_check');
  const taken = new Set();
  assert.equal(toId('build', taken), 'build');
  assert.equal(toId('build', taken), 'build_2', 'collisions are resolved, not silently merged');
});

test("GitHub's status/conclusion pairs map onto states", () => {
  assert.equal(stateOf({ status: 'in_progress' }), 'running');
  assert.equal(stateOf({ status: 'queued' }), 'queued');
  assert.equal(stateOf({ status: 'completed', conclusion: 'success' }), 'success');
  assert.equal(stateOf({ status: 'completed', conclusion: 'failure' }), 'error');
  assert.equal(stateOf({ status: 'completed', conclusion: 'timed_out' }), 'error');
  assert.equal(stateOf({ status: 'completed', conclusion: 'cancelled' }), 'cancelled');
  assert.equal(stateOf({ status: 'completed', conclusion: 'skipped' }), 'skipped');
  assert.equal(stateOf({ status: 'completed', conclusion: 'action_required' }), 'waiting');
  assert.equal(stateOf(null), 'idle');
});

test('the cancelled state it introduces is a real, renderable state', () => {
  const states = normalizeStates(GITHUB_STATES);
  assert.ok(states.cancelled.style && states.cancelled.darkStyle);
  assert.ok(states.success.style, 'and the default vocabulary survives');
});

test('a real run produces a graph the library accepts', () => {
  const { graph } = fromGitHubActions(RUN);
  const normalized = normalizeGraph(graph);
  assert.equal(Object.keys(normalized.nodes).length, 7);
  assert.equal(normalized.nodes.test_node_22.label, 'test (node 22)');
  assert.equal(normalized.direction, 'LR');
});

test('stages are inferred from start times', () => {
  const stages = toStages(RUN.jobs).map((jobs) => jobs.map((j) => j.name));
  assert.deepEqual(stages, [
    ['setup'],
    ['lint', 'test (node 20)', 'test (node 22)', 'browser tests'],
    ['build'],
    ['publish']
  ]);
});

test('edges are drawn only where one side is a single job', () => {
  assert.deepEqual(linkStages([['a'], ['b', 'c']]), [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }]);
  assert.deepEqual(linkStages([['a', 'b'], ['c']]), [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }]);
  assert.deepEqual(linkStages([['a', 'b'], ['c', 'd']]), [], 'no invented pairings between two wide stages');
});

test('inferred stages are also rendered as subgraphs, so order survives without edges', () => {
  const { graph, meta } = fromGitHubActions(RUN);
  assert.equal(meta.inferredDependencies, true);
  assert.deepEqual(graph.groups.map((g) => g.label), ['Stage 1', 'Stage 2', 'Stage 3', 'Stage 4']);
  assert.equal(graph.groups[1].nodes.length, 4);
});

test('an explicit needs map wins and produces exact edges', () => {
  const { graph, meta } = fromGitHubActions(RUN, {
    needs: { lint: 'setup', 'test (node 22)': ['setup'], build: ['lint', 'test (node 22)'] }
  });
  assert.equal(meta.inferredDependencies, false);
  assert.deepEqual(graph.groups, []);
  assert.deepEqual(graph.edges, [
    { from: 'setup', to: 'lint' },
    { from: 'setup', to: 'test_node_22' },
    { from: 'lint', to: 'build' },
    { from: 'test_node_22', to: 'build' }
  ]);
});

test('a needs entry naming a job that is not in the run is dropped, not fatal', () => {
  const { graph } = fromGitHubActions(RUN, { needs: { build: ['ghost', 'setup'] } });
  assert.deepEqual(graph.edges, [{ from: 'setup', to: 'build' }]);
});

test('the initial state carries conclusion, duration and a link back to the log', () => {
  const { initial } = fromGitHubActions(RUN);
  assert.equal(initial.test_node_22.state, 'error');
  assert.equal(initial.test_node_20.state, 'success');
  assert.equal(initial.publish.state, 'skipped');
  assert.match(initial.setup.badge, /^\d+\.\d+s$/);
  assert.match(initial.test_node_20.badge, /^\d+m \d+s$/, 'long jobs read as minutes');
  assert.match(initial.test_node_22.data.url, /\/job\/3413$/);
});

test('the events replay the run in order and end where the run ended', () => {
  const { events, initial } = fromGitHubActions(RUN);
  assert.equal(events.length, 14, 'a start and an end per job');
  assert.ok(events.every((e, i) => i === 0 || events[i - 1].t <= e.t), 'sorted');

  const states = {};
  const tl = new Timeline(events, {
    apply: (patch) => Object.entries(patch).forEach(([id, entry]) => {
      states[id] = typeof entry === 'string' ? entry : entry.state || states[id];
    })
  });
  tl.seek(tl.duration);
  for (const id of Object.keys(initial)) assert.equal(states[id], initial[id].state, `${id} ends where it ended`);
});

test('mid-run jobs come out as running, with no end event yet', () => {
  const live = {
    jobs: [
      { name: 'setup', status: 'completed', conclusion: 'success', started_at: '2026-08-31T09:00:00Z', completed_at: '2026-08-31T09:00:20Z', steps: [] },
      { name: 'test', status: 'in_progress', conclusion: null, started_at: '2026-08-31T09:00:22Z', completed_at: null, steps: [] },
      { name: 'deploy', status: 'queued', conclusion: null, started_at: null, completed_at: null, steps: [] }
    ]
  };
  const { initial, events } = fromGitHubActions(live);
  assert.equal(initial.test.state, 'running');
  assert.equal(initial.test.badge, null);
  assert.equal(initial.deploy.state, 'queued');
  assert.equal(events.filter((e) => e.node === 'test').length, 1);
});

test('steps mode draws one job as a sequence', () => {
  const { graph, initial, meta } = fromGitHubActions(RUN, { mode: 'steps', job: 'test (node 22)' });
  const normalized = normalizeGraph(graph);
  assert.equal(meta.job, 'test (node 22)');
  assert.equal(normalized.direction, 'TB');
  assert.deepEqual(Object.values(normalized.nodes).map((n) => n.label), ['Set up job', 'Checkout', 'npm ci', 'npm test']);
  assert.equal(normalized.edges.length, 3, 'steps are a chain');
  assert.equal(initial.npm_test.state, 'error', 'the failing step is the failing step');
});

test('it refuses payloads it cannot draw, with a reason', () => {
  assert.throws(() => fromGitHubActions({ jobs: [] }), /no jobs/);
  assert.throws(() => fromGitHubActions(RUN, { mode: 'steps', job: 'nope' }), /no job named/);
  assert.throws(() => fromGitHubActions(RUN, { mode: 'steps', job: 'build' }), /no steps/);
});

test('a bare array of jobs works as well as the API envelope', () => {
  assert.deepEqual(
    Object.keys(fromGitHubActions(RUN.jobs).graph.nodes),
    Object.keys(fromGitHubActions(RUN).graph.nodes)
  );
});

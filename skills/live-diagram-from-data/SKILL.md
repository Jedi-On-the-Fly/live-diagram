---
name: live-diagram-from-data
description: Turn run data you already have — a CI payload, a JSONL run log, a status_history table, a scheduler's events — into a live-diagram you can watch and replay. Use when the diagram should come from existing records rather than be drawn by hand.
---

# Building a live-diagram from data you already have

> Written against live-diagram 0.4.x — re-read this skill when the minor version moves.

Most systems that run things already write a row per state change. The shape differs every
time; the content is always the same three fields — **when**, **what**, **what state**. So
this is a naming exercise, not a parsing one.

## Step 1 — find the three fields

Look at one row of the real data and write down which key is the timestamp, which names the
thing, and which names its state. Everything else is optional decoration.

```js
// a row from somewhere
{ ts: 1756900000000, step: 'build', phase: 'running', ms: 4200, exit: null }
//  ^time            ^node          ^state
```

If rows carry a *duration* rather than a start and an end, you have one event per row and
the diagram will jump straight to the final state — usually fine for a status board, wrong
for a replay. For a replay, emit two rows per unit of work (started, finished).

## Step 2 — map them

```js
import { toTimelineEvents } from 'live-diagram';

const events = toTimelineEvents(rows, {
  time: 'ts', node: 'step', state: 'phase',
  badge: (row) => (row.ms ? `${(row.ms / 1000).toFixed(1)}s` : undefined),
  data:  (row) => ({ exitCode: row.exit })
});
```

`time`, `node` and `state` take a field name **or** an accessor function. `badge` and `data`
are functions; returning `undefined` omits the field. A row that names no node or no state
is not a state change and is dropped — log lines and heartbeats live in the same stream and
must not become events.

State names in your data will not be the library's. Either translate in the accessor, or —
better — declare a vocabulary in your words:

```js
const STATES = {
  pending:  { label: 'Pending',  style: 'fill:#f1f5f9,stroke:#94a3b8,color:#475569',
                                 darkStyle: 'fill:#1e293b,stroke:#64748b,color:#94a3b8' },
  degraded: { label: 'Degraded', style: 'fill:#fef9c3,stroke:#ca8a04,color:#713f12',
                                 darkStyle: 'fill:#854d0e,stroke:#facc15,color:#fef9c3' }
};
```

A status is a name and a name maps to a treatment. Never a branch in a render function.

## Step 3 — get a graph

In order of preference:

1. **You have the structure declared somewhere** — a workflow YAML, a DAG definition, a
   `needs:` map. Use it. Write the nodes and edges out, or generate them.
2. **Mermaid source already exists** — a diagram in the README, a `flowchart` or
   `stateDiagram-v2` fence. Pass the source string straight in as `graph`; it is parsed.
3. **You have only the log.** `graphFromEvents(events)` builds nodes in first-seen order and
   chains them in that order. **The chain is a guess and a deliberately visible one** — say
   so in the UI, and replace it with a real graph as soon as you have one.

```js
import { graphFromEvents } from 'live-diagram';
const graph = graphFromEvents(events, { direction: 'LR' });
```

## Step 4 — mount and replay

```js
const diagram = new LiveDiagram({ mount: '#run', graph, states: STATES });
const timeline = diagram.timeline(events);

timeline.seek(timeline.duration);              // at rest: show how it ended
// or: timeline.play({ speed: 4, loop: true });
```

`Timeline` gives you `play`, `pause`, `seek(ms)`, `step()` (exactly one event, because a
"next" button that sometimes advances by three is a confusing button), `reset()`, plus
`position`, `index`, `length` and `duration`. `LiveDiagram.transport(diagram, timeline,
{ mount })` is the row of buttons, wired correctly — scrubbing pauses playback, the clock
follows the timeline rather than a second timer.

## GitHub Actions specifically

```js
import { fromGitHubActions } from 'live-diagram';

const payload = await fetch(
  `https://api.github.com/repos/${repo}/actions/runs/${runId}/jobs`,
  { headers: { accept: 'application/vnd.github+json' } }
).then((r) => r.json());

const { graph, states, initial, events, meta } = fromGitHubActions(payload);
const diagram = new LiveDiagram({ mount: '#run', graph, states, initial });
diagram.timeline(events).play({ speed: 12 });
```

**Read `meta.inferredDependencies` and act on it.** That endpoint does not return the
`needs:` graph — it lives in the workflow YAML — so by default jobs are grouped into stages
by start time and drawn as subgraphs, and edges are only drawn between consecutive stages
where one side is a single job. Pass the real thing when you have it:

```js
fromGitHubActions(payload, { needs: { deploy: ['test', 'build'], test: ['install'] } });
fromGitHubActions(payload, { mode: 'steps', job: 'build' });   // one job's steps, in order
```

## Live data, not just history

The same events that replay can arrive live. A source is anything with `start(emit, notify)`
and `stop()`:

```js
diagram.connect(pollSource(async () => {
  const rows = await fetch('/api/status').then((r) => r.json());
  return Object.fromEntries(rows.map((r) => [r.step, r.phase]));
}, { interval: 5000 }));
```

`webSocketSource(url, { parse })` and `eventSourceSource(url, { parse })` also ship. **On any
pushed feed, pass `backfill`** — a socket that drops and reconnects does not bring the missed
events with it, and a diagram that keeps rendering is confidently wrong:

```js
diagram.connect(webSocketSource(url, { parse }), {
  backfill: () => fetch(`/runs/${id}`).then((r) => r.json()),
  staleAfter: 30000
});
```

## Sanity checks on real data

- **Timestamps.** Absolute epoch ms or already-relative both work — the timeline rebases to
  zero either way — but mixing the two in one list produces a nonsense duration. Check
  `timeline.duration` against what you expect before shipping.
- **Ordering.** Events are sorted by time, so out-of-order rows are fine; rows with a
  *missing* time all land at 0 and apply at once.
- **Node ids** must match `[A-Za-z_][A-Za-z0-9_]*`. Free-text names need mapping — the
  adapters do it for you (`toId`), a hand-rolled mapping must too.
- **Unknown nodes.** A patch naming a node the graph does not have is reported on the
  `warning` event and otherwise ignored; pass `strict: true` while developing so it throws
  instead of silently doing nothing.
- **Cardinality.** A few thousand events replay in microseconds. Tens of thousands of nodes
  is a Mermaid layout problem, not a state problem — aggregate first.

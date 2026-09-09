/**
 * GitHub Actions adapter.
 *
 * `GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs` returns everything
 * needed to draw a workflow run as a live diagram — except the one thing you
 * would most like: the `needs:` graph, which lives in the workflow YAML and is
 * not exposed by that endpoint. So this adapter takes it either way:
 *
 *   fromGitHubActions(payload)                       // infers stages from timing
 *   fromGitHubActions(payload, { needs: {…} })       // exact, from your YAML
 *
 * The inferred form groups jobs into stages by when they started, which is
 * what a reader of a CI dashboard actually wants to see, and never invents an
 * edge it cannot justify (see `linkStages`).
 */

/** GitHub's own vocabulary, mapped to states this library will style. */
const CONCLUSION_STATES = {
  success: 'success',
  failure: 'error',
  timed_out: 'error',
  startup_failure: 'error',
  cancelled: 'cancelled',
  skipped: 'skipped',
  neutral: 'skipped',
  stale: 'skipped',
  action_required: 'waiting'
};

const STATUS_STATES = {
  queued: 'queued',
  waiting: 'waiting',
  pending: 'queued',
  requested: 'queued',
  in_progress: 'running',
  completed: 'success'
};

/** `cancelled` is not in the default vocabulary; everything else already is. */
export const GITHUB_STATES = {
  cancelled: {
    label: 'cancelled', icon: '⊘',
    style: 'fill:#f1f5f9,stroke:#94a3b8,color:#475569',
    darkStyle: 'fill:#1e293b,stroke:#64748b,color:#94a3b8'
  }
};

/** @returns {string} The state a job or step is in right now. */
export function stateOf(item) {
  if (!item) return 'idle';
  if (item.status === 'completed') return CONCLUSION_STATES[item.conclusion] || 'success';
  return STATUS_STATES[item.status] || 'idle';
}

/** Job names are free text; node ids are not. */
export function toId(name, taken) {
  let id = String(name || 'job')
    .normalize('NFKD').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'j$1') || 'job';
  if (!taken) return id;
  let unique = id;
  let n = 2;
  while (taken.has(unique)) unique = `${id}_${n++}`;
  taken.add(unique);
  return unique;
}

function ms(from, to) {
  const a = from ? Date.parse(from) : NaN;
  const b = to ? Date.parse(to) : NaN;
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, b - a) : null;
}

function duration(item) {
  const took = ms(item.started_at, item.completed_at);
  if (took == null) return null;
  return took >= 60000 ? `${Math.floor(took / 60000)}m ${Math.round((took % 60000) / 1000)}s` : `${(took / 1000).toFixed(1)}s`;
}

/**
 * Groups jobs into stages by start time: everything that started within
 * `gapMs` of the stage's first job belongs to that stage. Matches how people
 * read a pipeline — "these three ran together" — without pretending to know
 * dependencies GitHub did not tell us about.
 */
export function toStages(jobs, gapMs) {
  const gap = Number.isFinite(gapMs) ? gapMs : 5000;
  const sorted = jobs.slice().sort((a, b) => Date.parse(a.started_at || 0) - Date.parse(b.started_at || 0));
  const stages = [];
  for (const job of sorted) {
    const at = Date.parse(job.started_at || 0) || 0;
    const stage = stages[stages.length - 1];
    if (stage && at - stage.at <= gap) stage.jobs.push(job);
    else stages.push({ at, jobs: [job] });
  }
  return stages.map((s) => s.jobs);
}

/**
 * Edges between consecutive stages — but only where one side is a single job,
 * so the edge means "this, then those" or "those, then this".
 *
 * Between two multi-job stages there is no honest single-edge story (which of
 * the three fed which of the three?), and drawing every pair produces a hairball
 * that says less than the grouping already does. So it draws nothing there, and
 * the stage subgraphs carry the order.
 */
export function linkStages(stageIds) {
  const edges = [];
  for (let i = 0; i < stageIds.length - 1; i++) {
    const from = stageIds[i];
    const to = stageIds[i + 1];
    if (from.length !== 1 && to.length !== 1) continue;
    for (const a of from) for (const b of to) edges.push({ from: a, to: b });
  }
  return edges;
}

/**
 * Maps a jobs payload onto a graph, a state vocabulary and a replayable
 * timeline.
 *
 * @param {object|Array} payload - The `/jobs` response, or its `jobs` array
 * @param {object} [options]
 * @param {Object.<string, Array<string>>} [options.needs] - Exact dependencies, keyed by job name
 * @param {'jobs'|'steps'} [options.mode='jobs']
 * @param {string} [options.job] - Which job's steps to draw in `steps` mode
 * @param {'TB'|'LR'} [options.direction='LR']
 * @param {number} [options.stageGapMs=5000] - Start-time tolerance when inferring stages
 * @param {boolean} [options.groups=true] - Render inferred stages as subgraphs
 * @returns {{graph: object, states: object, events: Array, initial: object, meta: object}}
 */
export function fromGitHubActions(payload, options) {
  const opts = options || {};
  const all = Array.isArray(payload) ? payload : (payload && payload.jobs) || [];
  if (!all.length) throw new Error('fromGitHubActions: no jobs in the payload');

  if (opts.mode === 'steps') return fromSteps(all, opts);

  const taken = new Set();
  const byName = new Map();
  const nodes = {};
  const initial = {};
  const events = [];

  for (const job of all) {
    const id = toId(job.name, taken);
    byName.set(job.name, id);
    nodes[id] = {
      label: job.name,
      shape: 'rect',
      description: `${job.status}${job.conclusion ? ` · ${job.conclusion}` : ''}`,
      meta: { url: job.html_url, runner: job.runner_name || null, steps: (job.steps || []).length, id: job.id }
    };
    const state = stateOf(job);
    initial[id] = { state, badge: duration(job), data: { conclusion: job.conclusion, url: job.html_url } };

    if (job.started_at) events.push({ t: Date.parse(job.started_at), node: id, state: 'running' });
    if (job.completed_at) {
      events.push({ t: Date.parse(job.completed_at), node: id, state, badge: duration(job),
                    data: { conclusion: job.conclusion, url: job.html_url } });
    }
  }

  let edges = [];
  let groups = [];
  let inferred = true;

  if (opts.needs && typeof opts.needs === 'object') {
    inferred = false;
    for (const [name, deps] of Object.entries(opts.needs)) {
      const to = byName.get(name);
      if (!to) continue;
      for (const dep of [].concat(deps || [])) {
        const from = byName.get(dep);
        if (from) edges.push({ from, to });
      }
    }
  } else {
    const stages = toStages(all, opts.stageGapMs).map((stage) => stage.map((job) => byName.get(job.name)));
    edges = linkStages(stages);
    if (opts.groups !== false && stages.length > 1) {
      groups = stages.map((ids, i) => ({ id: `stage_${i + 1}`, label: `Stage ${i + 1}`, nodes: ids }));
    }
  }

  return {
    graph: { direction: opts.direction || 'LR', nodes, edges, groups },
    states: GITHUB_STATES,
    initial,
    events: events.sort((a, b) => a.t - b.t),
    meta: {
      jobs: all.length,
      inferredDependencies: inferred,
      startedAt: all.map((j) => j.started_at).filter(Boolean).sort()[0] || null,
      conclusion: all.some((j) => j.conclusion === 'failure') ? 'failure'
        : all.every((j) => j.conclusion === 'success') ? 'success' : 'mixed'
    }
  };
}

/** One job's steps, in order — the closest thing GitHub gives you to a real sequence. */
function fromSteps(jobs, opts) {
  const job = opts.job ? jobs.find((j) => j.name === opts.job) : jobs[0];
  if (!job) throw new Error(`fromGitHubActions: no job named "${opts.job}"`);
  const steps = (job.steps || []).slice().sort((a, b) => (a.number || 0) - (b.number || 0));
  if (!steps.length) throw new Error(`fromGitHubActions: job "${job.name}" has no steps in this payload`);

  const taken = new Set();
  const nodes = {};
  const edges = [];
  const initial = {};
  const events = [];
  let previous = null;

  for (const step of steps) {
    const id = toId(step.name, taken);
    nodes[id] = { label: step.name, shape: 'rect', description: `step ${step.number}` };
    initial[id] = { state: stateOf(step), badge: duration(step) };
    if (previous) edges.push({ from: previous, to: id });
    previous = id;
    if (step.started_at) events.push({ t: Date.parse(step.started_at), node: id, state: 'running' });
    if (step.completed_at) events.push({ t: Date.parse(step.completed_at), node: id, state: stateOf(step), badge: duration(step) });
  }

  return {
    graph: { direction: opts.direction || 'TB', nodes, edges, groups: [] },
    states: GITHUB_STATES,
    initial,
    events: events.sort((a, b) => a.t - b.t),
    meta: { job: job.name, steps: steps.length, inferredDependencies: false }
  };
}

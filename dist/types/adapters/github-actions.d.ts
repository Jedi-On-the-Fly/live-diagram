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
/** `cancelled` is not in the default vocabulary; everything else already is. */
export declare const GITHUB_STATES: {
    cancelled: {
        label: string;
        icon: string;
        style: string;
        darkStyle: string;
    };
};
/** @returns {string} The state a job or step is in right now. */
export declare function stateOf(item: any): string;
/** Job names are free text; node ids are not. */
export declare function toId(name: any, taken: any): string;
/**
 * Groups jobs into stages by start time: everything that started within
 * `gapMs` of the stage's first job belongs to that stage. Matches how people
 * read a pipeline — "these three ran together" — without pretending to know
 * dependencies GitHub did not tell us about.
 */
export declare function toStages(jobs: any, gapMs: any): any[];
/**
 * Edges between consecutive stages — but only where one side is a single job,
 * so the edge means "this, then those" or "those, then this".
 *
 * Between two multi-job stages there is no honest single-edge story (which of
 * the three fed which of the three?), and drawing every pair produces a hairball
 * that says less than the grouping already does. So it draws nothing there, and
 * the stage subgraphs carry the order.
 */
export declare function linkStages(stageIds: any): any[];
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
export declare function fromGitHubActions(payload: object | any[], options?: {
    needs?: Record<string, string[]>;
    mode?: 'jobs' | 'steps';
    job?: string;
    direction?: 'TB' | 'LR';
    stageGapMs?: number;
    groups?: boolean;
}): {
    graph: object;
    states: object;
    events: any[];
    initial: object;
    meta: object;
};

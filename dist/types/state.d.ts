/**
 * The state channel.
 *
 * Everything that changes about a diagram after it is drawn goes through
 * `patch()`. There is no second path — no direct mutation, no "just set this
 * one node". One entry point is what makes the timeline, live streaming and
 * two-run diffing the same feature wearing different hats.
 *
 * A patch reports whether it was STRUCTURAL (a node changed state, so the
 * diagram definition must be rebuilt) or merely decorative (a badge or a data
 * payload changed, so the overlay is enough). Re-parsing a diagram to move a
 * "42s" label is the kind of waste that makes people write their own.
 */
export type PatchEntry = {
    /**
     * - The new state name
     */
    state?: string;
    /**
     * - Chip text; null clears it
     */
    badge?: string | null;
    /**
     * - Payload carried on the node; null clears it
     */
    data?: object | null;
    /**
     * - Layer `data` onto the previous payload
     */
    merge?: boolean;
};
export type StatePatch = Object<string, string | PatchEntry>;
/**
 * @typedef {Object} PatchEntry
 * @property {string} [state] - The new state name
 * @property {?string} [badge] - Chip text; null clears it
 * @property {?object} [data] - Payload carried on the node; null clears it
 * @property {boolean} [merge] - Layer `data` onto the previous payload
 */
/**
 * A patch: node id to a state name, or to a PatchEntry.
 * @typedef {Object.<string, string|PatchEntry>} StatePatch
 */
/**
 * @param {object} options
 * @param {Array<string>} options.nodes - Known node ids
 * @param {Array<string>} [options.edges] - Known edge ids
 * @param {string} [options.defaultState='idle']
 * @param {boolean} [options.strict=false] - Throw instead of reporting unknown ids
 */
export declare class StateStore {
    defaultState: any;
    strict: boolean;
    known: Set<any>;
    knownEdges: Set<any>;
    states: {};
    badges: {};
    data: {};
    edges: {};
    edgeData: {};
    constructor(options: any);
    /** Replaces the set of known edges (after a graph swap). */
    setEdges(edges: any): void;
    /** @returns {{state: string, data: ?object}} */
    getEdge(id: any): {
        state: string;
        data: object | null;
    };
    /** Replaces the set of known nodes (after a graph swap), keeping what still applies. */
    setNodes(nodes: any): void;
    /** @returns {{state: string, badge: ?string, data: ?object}} */
    get(id: any): {
        state: string;
        badge: string | null;
        data: object | null;
    };
    /** @returns {object} A deep-enough copy: safe to keep, safe to hand to a listener. */
    snapshot(): object;
    /**
     * Applies a patch.
     *
     * Accepted forms, mixable in one call:
     *   { build: 'running' }
     *   { build: { state: 'success', badge: '42s', data: {...} } }
     *   { build: { badge: null } }            // clears the badge
     *
     * Edge ids (`build->test`) are accepted in the same patch as node ids: one
     * door for state, whatever the state is about.
     *
     * @param {StatePatch} patch
     * @returns {{changed: Array<string>, edgesChanged: Array<string>, structural: boolean, unknown: Array<string>}}
     */
    apply(patch: StatePatch): {
        changed: Array<string>;
        edgesChanged: Array<string>;
        structural: boolean;
        unknown: Array<string>;
    };
    /**
     * Replaces the whole state at once (used by seek/replay).
     * @param {?object} snapshot - {states, badges, data}; null resets to defaults.
     */
    reset(snapshot: object | null): object;
    /** Every node back to the default state, badges and data cleared. */
    clear(): object;
}
/**
 * Compares two snapshots — the primitive behind "diff two runs".
 * @returns {Array<{node, from, to}>}
 */
export declare function diffSnapshots(a: any, b: any): Array<{
    node: any;
    from: any;
    to: any;
}>;

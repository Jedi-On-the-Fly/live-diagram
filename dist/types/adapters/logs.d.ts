/**
 * Log adapters — turning rows you already have into a timeline.
 *
 * Most systems that run things already write a row per state change: a JSONL
 * run log, a CI API response, a `status_history` table. The shape differs
 * every time, but the content is always the same three fields, so mapping is a
 * naming exercise rather than a parsing one.
 */
/**
 * Maps arbitrary rows onto timeline events.
 *
 * @param {Array<object>} rows
 * @param {object} [mapping]
 * @param {string|function} [mapping.time='timestamp'] - Field name or accessor
 * @param {string|function} [mapping.node='nodeId']
 * @param {string|function} [mapping.state='status']
 * @param {function(object): (string|undefined)} [mapping.badge] - Return undefined to omit
 * @param {function(object): (object|undefined)} [mapping.data]
 * @returns {Array<object>} Events accepted by `diagram.timeline()`
 *
 * @example
 * const events = toTimelineEvents(rows, {
 *   time: 'ts', node: 'step', state: 'phase',
 *   badge: (row) => (row.ms ? `${(row.ms / 1000).toFixed(1)}s` : undefined)
 * });
 */
export declare function toTimelineEvents(rows: Array<object>, mapping?: {
    time?: string | Function;
    node?: string | Function;
    state?: string | Function;
}): Array<object>;
/**
 * Builds a graph from the rows themselves, for when you have a log but no
 * declared structure: nodes in first-seen order, chained in that order.
 *
 * A chain is a guess, and a deliberately visible one — pass a real graph
 * whenever you have one. It exists so that "I have a log" is enough to see
 * something.
 *
 * @param {Array<object>} events - Output of toTimelineEvents
 * @param {object} [options]
 * @param {'TB'|'LR'} [options.direction='LR']
 * @param {boolean} [options.chain=true] - Link nodes in first-seen order
 * @returns {object} A graph spec
 */
export declare function graphFromEvents(events: Array<object>, options?: {
    direction?: 'TB' | 'LR';
    chain?: boolean;
}): object;

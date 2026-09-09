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
export function toTimelineEvents(rows, mapping) {
  const map = mapping || {};
  const read = (row, key, fallback) => {
    const accessor = map[key] || fallback;
    return typeof accessor === 'function' ? accessor(row) : row[accessor];
  };
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const node = read(row, 'node', 'nodeId');
      const state = read(row, 'state', 'status');
      // A row that names no node or no state is not a state change — log lines
      // and heartbeats live in the same stream and must not become events.
      if (!node || !state) return null;
      const event = { t: Number(read(row, 'time', 'timestamp')) || 0, node, state };
      if (typeof map.badge === 'function') {
        const badge = map.badge(row);
        if (badge !== undefined) event.badge = badge;
      }
      if (typeof map.data === 'function') {
        const data = map.data(row);
        if (data !== undefined) event.data = data;
      }
      return event;
    })
    .filter(Boolean);
}

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
export function graphFromEvents(events, options) {
  const opts = options || {};
  const order = [];
  const seen = new Set();
  for (const event of events || []) {
    if (event && event.node && !seen.has(event.node)) { seen.add(event.node); order.push(event.node); }
  }
  const nodes = {};
  for (const id of order) nodes[id] = { label: id };
  const edges = opts.chain === false ? []
    : order.slice(1).map((to, i) => ({ from: order[i], to }));
  return { direction: opts.direction || 'LR', nodes, edges };
}

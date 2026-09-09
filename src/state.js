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
export class StateStore {
  constructor(options) {
    const opts = options || {};
    this.defaultState = opts.defaultState || 'idle';
    this.strict = opts.strict === true;
    this.known = new Set(opts.nodes || []);
    this.knownEdges = new Set(opts.edges || []);
    this.states = {};
    this.badges = {};
    this.data = {};
    // Edges live in their own maps rather than sharing `states`: a snapshot has
    // to stay a map of NODE states, or every consumer of one (restore, diff,
    // the legend's counts) would silently start counting edges too.
    this.edges = {};
    this.edgeData = {};
    for (const id of this.known) this.states[id] = this.defaultState;
    for (const id of this.knownEdges) this.edges[id] = this.defaultState;
  }

  /** Replaces the set of known edges (after a graph swap). */
  setEdges(edges) {
    const next = new Set(edges || []);
    for (const id of Array.from(this.knownEdges)) {
      if (!next.has(id)) { delete this.edges[id]; delete this.edgeData[id]; }
    }
    for (const id of next) if (!(id in this.edges)) this.edges[id] = this.defaultState;
    this.knownEdges = next;
  }

  /** @returns {{state: string, data: ?object}} */
  getEdge(id) {
    return {
      state: this.edges[id] || this.defaultState,
      data: Object.prototype.hasOwnProperty.call(this.edgeData, id) ? this.edgeData[id] : null
    };
  }

  /** Replaces the set of known nodes (after a graph swap), keeping what still applies. */
  setNodes(nodes) {
    const next = new Set(nodes || []);
    for (const id of Array.from(this.known)) {
      if (!next.has(id)) { delete this.states[id]; delete this.badges[id]; delete this.data[id]; }
    }
    for (const id of next) {
      if (!(id in this.states)) this.states[id] = this.defaultState;
    }
    this.known = next;
  }

  /** @returns {{state: string, badge: ?string, data: ?object}} */
  get(id) {
    return {
      state: this.states[id] || this.defaultState,
      badge: Object.prototype.hasOwnProperty.call(this.badges, id) ? this.badges[id] : null,
      data: Object.prototype.hasOwnProperty.call(this.data, id) ? this.data[id] : null
    };
  }

  /** @returns {object} A deep-enough copy: safe to keep, safe to hand to a listener. */
  snapshot() {
    return {
      states: { ...this.states },
      badges: { ...this.badges },
      data: { ...this.data },
      edges: { ...this.edges },
      edgeData: { ...this.edgeData }
    };
  }

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
  apply(patch) {
    const result = { changed: [], edgesChanged: [], structural: false, unknown: [] };
    if (!patch || typeof patch !== 'object') return result;

    for (const id of Object.keys(patch)) {
      if (this.knownEdges.has(id)) {
        const raw = patch[id];
        const entry = (typeof raw === 'string' || raw == null) ? { state: raw } : raw;
        let touched = false;
        if ('state' in entry && entry.state != null) {
          const next = String(entry.state);
          if (this.edges[id] !== next) { this.edges[id] = next; touched = true; }
        }
        if ('data' in entry) {
          if (entry.data == null) {
            if (Object.prototype.hasOwnProperty.call(this.edgeData, id)) { delete this.edgeData[id]; touched = true; }
          } else {
            this.edgeData[id] = entry.merge ? { ...(this.edgeData[id] || {}), ...entry.data } : entry.data;
            touched = true;
          }
        }
        if (touched) result.edgesChanged.push(id);
        continue;
      }
      if (!this.known.has(id)) {
        if (this.strict) throw new Error(`patch references unknown node "${id}"`);
        result.unknown.push(id);
        continue;
      }
      const raw = patch[id];
      const entry = (typeof raw === 'string' || raw == null) ? { state: raw } : raw;
      let touched = false;

      if ('state' in entry && entry.state != null) {
        const next = String(entry.state);
        if (this.states[id] !== next) {
          this.states[id] = next;
          result.structural = true;
          touched = true;
        }
      }

      if ('badge' in entry) {
        const next = entry.badge == null ? null : String(entry.badge);
        const had = Object.prototype.hasOwnProperty.call(this.badges, id) ? this.badges[id] : null;
        if (had !== next) {
          if (next == null) delete this.badges[id]; else this.badges[id] = next;
          touched = true;
        }
      }

      if ('data' in entry) {
        if (entry.data == null) {
          if (Object.prototype.hasOwnProperty.call(this.data, id)) { delete this.data[id]; touched = true; }
        } else {
          // `merge: true` keeps the previous payload and layers on top — the
          // usual shape when a stream reports one field at a time.
          this.data[id] = entry.merge ? { ...(this.data[id] || {}), ...entry.data } : entry.data;
          touched = true;
        }
      }

      if (touched && !result.changed.includes(id)) result.changed.push(id);
    }
    return result;
  }

  /**
   * Replaces the whole state at once (used by seek/replay).
   * @param {?object} snapshot - {states, badges, data}; null resets to defaults.
   */
  reset(snapshot) {
    const snap = snapshot || {};
    const states = snap.states || {};
    const edges = snap.edges || {};
    this.states = {};
    for (const id of this.known) this.states[id] = states[id] || this.defaultState;
    this.edges = {};
    for (const id of this.knownEdges) this.edges[id] = edges[id] || this.defaultState;
    this.badges = { ...(snap.badges || {}) };
    this.data = { ...(snap.data || {}) };
    this.edgeData = { ...(snap.edgeData || {}) };
    return this.snapshot();
  }

  /** Every node back to the default state, badges and data cleared. */
  clear() { return this.reset(null); }
}

/**
 * Compares two snapshots — the primitive behind "diff two runs".
 * @returns {Array<{node, from, to}>}
 */
export function diffSnapshots(a, b) {
  const left = (a && a.states) || {};
  const right = (b && b.states) || {};
  const ids = new Set([...Object.keys(left), ...Object.keys(right)]);
  const out = [];
  for (const id of ids) {
    if (left[id] !== right[id]) out.push({ node: id, from: left[id] || null, to: right[id] || null });
  }
  return out;
}

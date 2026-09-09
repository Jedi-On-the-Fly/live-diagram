/**
 * LiveDiagram — a diagram you can push state into and get events out of.
 *
 * The contract is two sentences long:
 *   1. `patch()` is the only way state changes.
 *   2. The library never mutates the graph you gave it.
 *
 * Replay, live streaming, run diffing and "click a node to do something" all
 * fall out of those two rules, which is why the API is small enough to read in
 * one sitting.
 */

import { Emitter } from './emitter.js';
import { normalizeGraph, edgeIds } from './graph.js';
import { normalizeStates, styleFor, edgeStyleFor } from './states.js';
import { StateStore } from './state.js';
import { Timeline } from './timeline.js';
import { Viewport } from './viewport.js';
import { Overlay } from './overlay.js';
import { ensureStyles } from './styles.js';
import { mermaidRenderer, resolveTheme } from './renderers/mermaid.js';

const CONTROL_BUTTONS = [
  { action: 'zoomIn', glyph: '+', title: 'Zoom in' },
  { action: 'zoomOut', glyph: '−', title: 'Zoom out' },
  { action: 'fit', glyph: '⤢', title: 'Fit to view' }
];

export class LiveDiagram extends Emitter {
  /**
   * @param {object} options
   * @param {Element|string} options.mount - Element or selector to render into
   * @param {import('./graph.js').GraphSpec} options.graph - Structure: nodes, edges, groups
   * @param {object} [options.states] - State vocabulary, merged over the defaults
   * @param {object} [options.initial] - Initial state patch
   * @param {object} [options.renderer] - Renderer adapter (defaults to Mermaid)
   * @param {string} [options.theme='auto'] - 'light' | 'dark' | 'auto'
   * @param {string} [options.defaultState='idle']
   * @param {boolean} [options.showIcons=false] - Prefix labels with state icons
   * @param {boolean} [options.controls=false] - Render the built-in zoom buttons
   * @param {boolean|'observe'} [options.autoFit=true] - Fit once after the
   *   first render; 'observe' keeps refitting as the container resizes, until
   *   the user zooms by hand; false never fits
   * @param {boolean} [options.strict=false] - Throw on patches for unknown nodes
   * @param {object|false} [options.viewport] - Viewport options (min, max, step,
   *   pan, wheelZoom, maxFitScale), or `false` for bare mode: no scroller and no
   *   chrome, for hosts that already own scrolling and zooming (see setGraph docs)
   */
  constructor(options) {
    super();
    const opts = options || {};
    this.options = opts;

    this.graph = normalizeGraph(opts.graph);
    this.states = normalizeStates(opts.states, { extend: opts.extendStates !== false });
    this.defaultState = opts.defaultState || 'idle';
    this.showIcons = opts.showIcons === true;
    this.theme = opts.theme || 'auto';
    this.renderer = opts.renderer || mermaidRenderer({ showIcons: this.showIcons });

    this.store = new StateStore({
      nodes: Object.keys(this.graph.nodes),
      edges: edgeIds(this.graph),
      defaultState: this.defaultState,
      strict: opts.strict === true
    });

    this._nodes = new Map();
    this._edges = new Map();
    this._rendering = false;
    this._pending = null;       // 'full' | 'restyle'
    this._destroyed = false;
    this._sources = [];
    this._timelines = [];
    this._didAutoFit = false;
    this._connection = 'none';
    this._lastUpdate = null;
    this._staleTimer = null;

    this._mountDom(opts.mount);
    if (opts.initial) this.store.apply(opts.initial);
    this.render();
  }

  // ---------------------------------------------------------------- mounting

  _mountDom(mount) {
    const el = typeof mount === 'string'
      ? (typeof document !== 'undefined' ? document.querySelector(mount) : null)
      : mount;
    if (!el) throw new Error(`LiveDiagram: mount target ${JSON.stringify(mount)} not found`);

    ensureStyles(el.ownerDocument);
    const doc = el.ownerDocument;

    // Bare mode: the host already has a scroller and its own zoom, and just
    // wants the diagram. Embedding a second scroll container inside one that
    // already scrolls is how nested-scrollbar bugs are born.
    const bare = this.options.viewport === false;

    this.root = doc.createElement('div');
    this.root.className = 'ld';
    this.root.setAttribute('data-theme', resolveTheme(this.theme));
    this.root.setAttribute('data-ld-connection', this._connection);
    this.root.setAttribute('data-ld-stale-label', this.options.staleLabel || 'disconnected — last known state');
    if (bare) this.root.setAttribute('data-chrome', 'none');

    this.canvas = doc.createElement('div');
    this.canvas.className = 'ld-canvas';

    this.overlayLayer = doc.createElement('div');
    this.overlayLayer.className = 'ld-overlay';

    if (bare) {
      this.scroller = this.root;
      this.root.appendChild(this.canvas);
      this.root.appendChild(this.overlayLayer);
    } else {
      this.scroller = doc.createElement('div');
      this.scroller.className = 'ld-viewport';
      this.scroller.appendChild(this.canvas);
      this.scroller.appendChild(this.overlayLayer);
      this.root.appendChild(this.scroller);
    }
    el.appendChild(this.root);

    this.overlays = new Overlay(this.overlayLayer, this.scroller);
    this.viewport = new Viewport({
      scroller: this.scroller,
      content: this.canvas,
      options: bare ? { pan: false, wheelZoom: false } : (this.options.viewport || {}),
      onChange: (scale, cause) => {
        this.overlays.sync(this._nodes, this.store.badges);
        // A hand zoom means the user has taken over; observing would fight them.
        if (cause === 'zoom') this._stopObserving();
        this.emit('zoom', { scale, cause });
      }
    });

    if (this.options.controls) this._mountControls(doc);
    this._bindInteractions();
  }

  _mountControls(doc) {
    const bar = doc.createElement('div');
    bar.className = 'ld-controls';
    for (const spec of CONTROL_BUTTONS) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = spec.glyph;
      button.title = spec.title;
      button.setAttribute('aria-label', spec.title);
      button.addEventListener('click', () => this[spec.action]());
      bar.appendChild(button);
    }
    this.root.appendChild(bar);
  }

  _bindInteractions() {
    // Delegation, not Mermaid `click` directives: it survives re-renders, needs
    // no global callback name, and is unaffected by securityLevel.
    this._onClick = (event) => {
      if (!event.target.closest) return;
      const node = event.target.closest('[data-ld-node]');
      if (node) { this.emit('nodeClick', this._nodePayload(node.getAttribute('data-ld-node'), event)); return; }
      const edge = event.target.closest('[data-ld-edge]');
      if (edge) this.emit('edgeClick', this._edgePayload(edge.getAttribute('data-ld-edge'), event));
    };
    this._onKey = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = event.target.closest && event.target.closest('[data-ld-node]');
      if (!target) return;
      event.preventDefault();
      this.emit('nodeClick', this._nodePayload(target.getAttribute('data-ld-node'), event));
    };
    this._onOver = (event) => {
      const target = event.target.closest && event.target.closest('[data-ld-node]');
      if (!target) return;
      const id = target.getAttribute('data-ld-node');
      if (id === this._hovered) return;
      this._hovered = id;
      this.emit('nodeHover', this._nodePayload(id, event));
    };
    this._onOut = (event) => {
      if (event.relatedTarget && event.relatedTarget.closest && event.relatedTarget.closest('[data-ld-node]')) return;
      if (this._hovered == null) return;
      this._hovered = null;
      this.emit('nodeHover', null);
    };

    this.canvas.addEventListener('click', this._onClick);
    this.canvas.addEventListener('keydown', this._onKey);
    this.canvas.addEventListener('mouseover', this._onOver);
    this.canvas.addEventListener('mouseout', this._onOut);
  }

  _edgePayload(id, event) {
    const entry = this.store.getEdge(id);
    const edge = this.graph.edges.find((e) => e.id === id) || null;
    return {
      id,
      edge,
      from: edge && edge.from,
      to: edge && edge.to,
      state: entry.state,
      data: entry.data,
      element: this._edges.get(id) || null,
      originalEvent: event || null
    };
  }

  _nodePayload(id, event) {
    const entry = this.store.get(id);
    return {
      id,
      node: this.graph.nodes[id],
      state: entry.state,
      badge: entry.badge,
      data: entry.data,
      element: this._nodes.get(id) || null,
      originalEvent: event || null
    };
  }

  // ----------------------------------------------------------------- state in

  /**
   * The one way state changes.
   *
   * @param {import('./state.js').StatePatch} patch - {nodeId: 'state'} or {nodeId: {state, badge, data, merge}}
   * @returns {LiveDiagram}
   */
  patch(patch) {
    const result = this.store.apply(patch);
    if (result.unknown.length) {
      this.emit('warning', { type: 'unknown-nodes', nodes: result.unknown });
    }
    if (result.changed.length || result.edgesChanged.length) {
      this.emit('change', {
        changed: result.changed,
        edgesChanged: result.edgesChanged,
        structural: result.structural,
        snapshot: this.store.snapshot()
      });
      // A state change repaints; a label change re-lays-out. Only the second
      // needs Mermaid again.
      this._schedule(result.structural && this.showIcons ? 'full' : 'restyle');
    }
    return this;
  }

  /**
   * Shorthand for a single node's state.
   * @param {string} id
   * @param {string} state
   */
  setState(id, state) { return this.patch({ [id]: state }); }

  /** Sets (or clears, with null) a node's badge. */
  badge(id, text) { return this.patch({ [id]: { badge: text } }); }

  /** Attaches an arbitrary payload to a node; `merge` layers onto the previous. */
  data(id, payload, merge) { return this.patch({ [id]: { data: payload, merge: merge === true } }); }

  /**
   * Anchors HTML to a node: a progress bar, a sparkline, a retry button, a line
   * of streaming output. It rides the same layer as badges, so it survives
   * re-renders and follows zoom and pan.
   *
   * Unlike the state methods this returns the ELEMENT, not the diagram: the
   * whole point of an overlay is that you keep updating it.
   *
   * @param {string} id - Node id
   * @param {Element|string|null} content - Element, HTML, or null to remove
   * @param {object} [options] - {position, offset, className, interactive}
   * @returns {?Element}
   */
  overlay(id, content, options) {
    const el = this.overlayLayer ? this.overlays.set(id, content, options) : null;
    this.overlays.sync(this._nodes, this.store.badges);
    return el;
  }

  /** Removes every custom overlay (badges are state, and stay). */
  clearOverlays() {
    this.overlays.clearItems();
    return this;
  }

  /** Every node back to the default state. */
  clear() {
    this.store.clear();
    this.emit('change', { changed: Object.keys(this.graph.nodes), structural: true, snapshot: this.store.snapshot() });
    this._schedule(this.showIcons ? 'full' : 'restyle');
    return this;
  }

  /** @returns {object} {states, badges, data} — safe to keep. */
  snapshot() { return this.store.snapshot(); }

  /** @returns {{state, badge, data}} */
  get(id) { return this.store.get(id); }

  /**
   * An edge's state. Edges are addressed as `from->to` (see `graph.edges[].id`).
   * @returns {{state, data}}
   */
  getEdge(id) { return this.store.getEdge(id); }

  /** Restores a snapshot wholesale (the primitive behind seek and diff). */
  restore(snapshot) {
    this.store.reset(snapshot);
    this.emit('change', { changed: Object.keys(this.graph.nodes), structural: true, snapshot: this.store.snapshot() });
    this._schedule(this.showIcons ? 'full' : 'restyle');
    return this;
  }

  // ---------------------------------------------------------------- structure

  /** Swaps the graph, keeping the state of nodes that still exist. */
  setGraph(graph) {
    this.graph = normalizeGraph(graph);
    this.store.setNodes(Object.keys(this.graph.nodes));
    this.store.setEdges(edgeIds(this.graph));
    this._didAutoFit = false;
    this._schedule('full');
    return this;
  }

  /** Swaps or extends the state vocabulary. */
  setStates(states, options) {
    this.states = normalizeStates(states, options || { extend: this.options.extendStates !== false });
    this._schedule('full');
    return this;
  }

  /** @param {string} theme - 'light' | 'dark' | 'auto' */
  setTheme(theme) {
    this.theme = theme || 'auto';
    this.root.setAttribute('data-theme', resolveTheme(this.theme));
    this._schedule('full');
    return this;
  }

  // ----------------------------------------------------------------- viewport

  zoom(scale) { this.viewport.zoom(scale); return this; }
  zoomIn() { this.viewport.zoomIn(); return this; }
  zoomOut() { this.viewport.zoomOut(); return this; }
  fit(padding) { this.viewport.fit(padding); return this; }
  resetView() { this.viewport.reset(); return this; }

  // ----------------------------------------------------------------- timeline

  /**
   * Builds a replay controller over a recorded event list.
   *
   * @param {Array<object>} events - [{t, node, state, badge?, data?}] or [{t, patch}]
   * @returns {Timeline}
   */
  timeline(events) {
    const tl = new Timeline(events, {
      apply: (patch) => this.patch(patch),
      onReset: () => { this.store.clear(); this._schedule(this.showIcons ? 'full' : 'restyle'); },
      onTick: (info) => this.emit('tick', info)
    });
    this._timelines.push(tl);
    return tl;
  }

  // ------------------------------------------------------------------ sources

  /**
   * Attaches a state source.
   *
   * A dropped connection is the failure mode that matters here. A socket that
   * reconnects does not bring back the events it missed, so a diagram that
   * simply keeps rendering is now confidently WRONG — showing a run that
   * finished ten minutes ago as still running. Two answers, both opt-in but
   * both cheap:
   *
   *   backfill  — asked for the truth on every (re)connect
   *   staleness — until the truth arrives, the diagram SAYS it is out of date
   *
   * @param {object|function} source - {start(emit, notify), stop()} or a start function
   * @param {object} [options]
   * @param {function(): Promise<object>} [options.backfill] - Resolves to a snapshot
   *   ({states, …} — applied with restore) or a patch (applied with patch)
   * @param {boolean} [options.markStale=true] - Show disconnection instead of hiding it
   * @param {number} [options.staleAfter] - Also go stale after this many ms with no
   *   update, for sources that fail silently rather than closing
   * @returns {function(): void} Detach.
   */
  connect(source, options) {
    const opts = options || {};
    const src = typeof source === 'function' ? { name: 'fn', start: source, stop: () => {} } : source;
    const markStale = opts.markStale !== false;
    let opened = false;

    const emit = (patch) => {
      this._lastUpdate = Date.now();
      if (this._connection !== 'live') this._setConnection('live', src);
      this._armStaleTimer(opts.staleAfter);
      this.patch(patch);
    };

    const runBackfill = async () => {
      if (typeof opts.backfill !== 'function') return;
      try {
        const truth = await opts.backfill();
        if (!truth) return;
        // A snapshot replaces everything (that is the point of asking for it);
        // anything else is treated as an ordinary patch.
        if (truth.states || truth.edges) this.restore(truth); else this.patch(truth);
        this.emit('backfill', { source: src.name, snapshot: this.store.snapshot() });
      } catch (error) {
        this.emit('error', { source: `backfill:${src.name}`, error });
      }
    };

    const notify = (kind, detail) => {
      if (kind === 'open') {
        const reconnected = opened;
        opened = true;
        this._setConnection('live', src);
        this._armStaleTimer(opts.staleAfter);
        this.emit('connection', { source: src.name, connected: true, reconnected });
        runBackfill();
      } else if (kind === 'close' || kind === 'error') {
        if (markStale) this._setConnection('stale', src);
        this.emit('connection', { source: src.name, connected: false, reconnected: false, detail });
      }
      this.emit(kind === 'error' ? 'error' : 'source', { source: src.name, kind, detail });
    };

    src.start(emit, notify);
    this._sources.push(src);
    // A source that never notifies (a plain function, a poll) still counts as
    // connected the moment it is attached.
    if (this._connection === 'none') this._setConnection('live', src);
    this._armStaleTimer(opts.staleAfter);

    return () => {
      src.stop();
      this._sources = this._sources.filter((s) => s !== src);
      // Detaching the last source leaves the diagram showing state nobody is
      // maintaining any more. Whether the socket dropped or you unplugged it
      // deliberately, what is on screen is now old — so it says so.
      if (!this._sources.length) this._setConnection(this._everLive ? 'stale' : 'none', src);
    };
  }

  /**
   * 'live' | 'stale' | 'none'. Reflected on the root as `data-ld-connection`,
   * so a stale diagram can be dimmed in CSS without any JavaScript of yours.
   */
  get connection() { return this._connection; }

  /** @returns {?number} When state last arrived, epoch ms. */
  get lastUpdate() { return this._lastUpdate || null; }

  _setConnection(next, src) {
    if (this._connection === next) return;
    if (next === 'live') this._everLive = true;
    this._connection = next;
    if (this.root) this.root.setAttribute('data-ld-connection', next);
    this.emit('stale', { stale: next === 'stale', source: src && src.name, since: this._lastUpdate || null });
  }

  _armStaleTimer(staleAfter) {
    if (this._staleTimer) { clearTimeout(this._staleTimer); this._staleTimer = null; }
    const after = Number(staleAfter);
    if (!Number.isFinite(after) || after <= 0) return;
    this._staleTimer = setTimeout(() => this._setConnection('stale', { name: 'timeout' }), after);
    if (this._staleTimer && typeof this._staleTimer.unref === 'function') this._staleTimer.unref();
  }

  // ------------------------------------------------------------------ drawing

  /** @returns {string} The current renderer definition (handy for export/debug). */
  definition() {
    if (typeof this.renderer.definition !== 'function') return '';
    return this.renderer.definition({
      graph: this.graph,
      snapshot: this.store.snapshot(),
      states: this.states,
      theme: this.theme,
      defaultState: this.defaultState
    });
  }

  /** @returns {string} The current SVG markup. */
  svg() {
    const el = this.canvas.querySelector('svg');
    return el ? el.outerHTML : '';
  }

  _schedule(kind) {
    if (this._destroyed) return;
    if (kind === 'full' || this._pending === 'full') this._pending = 'full';
    else this._pending = this._pending || kind;
    if (this._scheduled) return;
    this._scheduled = true;
    const run = () => {
      this._scheduled = false;
      const next = this._pending;
      this._pending = null;
      if (next === 'full') this.render();
      else this._restyle();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  /**
   * Full re-render: re-parses and re-lays-out the diagram.
   *
   * Renders are serialised through a promise chain. Mermaid's render is async,
   * and two overlapping renders on one container race to write innerHTML — the
   * loser's node map then points at elements that are no longer in the
   * document. Awaiting this resolves when the diagram on screen is yours.
   *
   * @returns {Promise<LiveDiagram>}
   */
  render() {
    if (this._destroyed) return Promise.resolve(this);
    this._chain = (this._chain || Promise.resolve()).then(() => this._renderNow());
    return this._chain.then(() => this);
  }

  async _renderNow() {
    if (this._destroyed) return this;
    this._rendering = true;
    try {
      const result = await this.renderer.render({
        container: this.canvas,
        graph: this.graph,
        snapshot: this.store.snapshot(),
        states: this.states,
        theme: this.theme,
        defaultState: this.defaultState
      });
      this._nodes = result.nodes || new Map();
      this._edges = result.edges || new Map();
      this._decorate();
      // The render replaced the SVG and its projected zoom width; re-project
      // before overlays measure anything.
      this.viewport.resync();
      this.overlays.sync(this._nodes, this.store.badges);
      if (this.options.autoFit !== false && !this._didAutoFit) {
        this._didAutoFit = true;
        this.viewport.fit();
        // Not in bare mode: there the scroller IS the content-sized root, so
        // every refit resizes the thing being observed — a ratchet.
        if (this.options.autoFit === 'observe' && this.options.viewport !== false) this._observeResize();
      }
      this.emit('render', { nodes: this._nodes, definition: result.definition });
    } catch (err) {
      this.emit('error', { source: 'render', error: err });
    } finally {
      this._rendering = false;
    }
    return this;
  }

  /**
   * The fast path: repaint node styles on the existing SVG.
   *
   * Layout does not change when a node goes from running to success, so
   * re-parsing the whole diagram to recolour one box is waste — and worse, it
   * makes the canvas flash and drops the user's selection. Falls back to a
   * full render if the SVG is not there yet.
   */
  _restyle() {
    if (this._destroyed) return this;
    if (!this._nodes.size || !this.canvas.querySelector('svg')) return this.render();
    const theme = resolveTheme(this.theme);
    for (const [id, el] of this._nodes) {
      const entry = this.store.get(id);
      const declarations = parseStyle(styleFor(this.states, entry.state, theme));
      const shape = el.querySelector('rect, circle, ellipse, polygon, path');
      if (shape) {
        if (declarations.fill) shape.style.fill = declarations.fill;
        if (declarations.stroke) shape.style.stroke = declarations.stroke;
        if (declarations['stroke-width']) shape.style.strokeWidth = declarations['stroke-width'];
      }
      if (declarations.color) {
        el.querySelectorAll('.nodeLabel, .label, foreignObject div, text, tspan')
          .forEach((label) => { label.style.color = declarations.color; label.style.fill = declarations.color; });
      }
      el.setAttribute('data-ld-state', entry.state);
      const stateLabel = (this.states[entry.state] && this.states[entry.state].label) || entry.state;
      el.setAttribute('aria-label', `${this.graph.nodes[id].label}: ${stateLabel}`);
    }
    for (const [id, path] of this._edges) {
      const entry = this.store.getEdge(id);
      const declarations = parseStyle(edgeStyleFor(this.states, entry.state, theme));
      // Mermaid ships `#<id> .flowchart-link { stroke: … }`; an inline style
      // outranks it. Note that `.ld-edge` transitions `stroke`, so the computed
      // value only equals the target once the transition has finished.
      const set = (prop, value) => {
        path.style.removeProperty(prop);
        if (value) path.style.setProperty(prop, value);
      };
      set('stroke', declarations.stroke);
      set('stroke-width', declarations['stroke-width']);
      // Cleared explicitly: a state that dashes an edge must not leave the next
      // state dashed too.
      set('stroke-dasharray', declarations['stroke-dasharray']);
      path.setAttribute('data-ld-edge-state', entry.state);
    }
    this.overlays.sync(this._nodes, this.store.badges);
    this.emit('restyle', { nodes: this._nodes, edges: this._edges });
    return this;
  }

  /** Makes rendered nodes focusable, labelled and queryable from CSS. */
  _decorate() {
    for (const [id, path] of this._edges) {
      path.setAttribute('data-ld-edge-state', this.store.getEdge(id).state);
    }
    for (const [id, el] of this._nodes) {
      const entry = this.store.get(id);
      const node = this.graph.nodes[id];
      const stateLabel = (this.states[entry.state] && this.states[entry.state].label) || entry.state;
      el.setAttribute('data-ld-state', entry.state);
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${node.label}: ${stateLabel}`);
      if (node.description) el.setAttribute('title', node.description);
    }
  }

  /**
   * autoFit 'observe': debounced refit on container resize. Stopped forever by
   * the first hand zoom (see `onChange`); without ResizeObserver, fit-once.
   * fit() is silent when the scale is unchanged, so the refit's own scrollbar
   * wiggle cannot loop back through here.
   */
  _observeResize() {
    if (this._resizeObserver || typeof ResizeObserver === 'undefined') return;
    this._resizeObserver = new ResizeObserver(() => {
      if (this._resizeTimer) clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => {
        this._resizeTimer = null;
        if (!this._destroyed) this.viewport.fit();
      }, 150);
    });
    this._resizeObserver.observe(this.scroller);
  }

  _stopObserving() {
    if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
    if (this._resizeTimer) { clearTimeout(this._resizeTimer); this._resizeTimer = null; }
  }

  // ------------------------------------------------------------------ cleanup

  /** Detaches sources, timers, listeners and DOM. Safe to call twice. */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    for (const src of this._sources) { try { src.stop(); } catch (_) { /* already stopped */ } }
    this._sources = [];
    if (this._staleTimer) { clearTimeout(this._staleTimer); this._staleTimer = null; }
    for (const tl of this._timelines) tl.destroy();
    this._timelines = [];
    this.canvas.removeEventListener('click', this._onClick);
    this.canvas.removeEventListener('keydown', this._onKey);
    this.canvas.removeEventListener('mouseover', this._onOver);
    this.canvas.removeEventListener('mouseout', this._onOut);
    this._stopObserving();
    this.viewport.destroy();
    this.overlays.clear();
    if (typeof this.renderer.destroy === 'function') this.renderer.destroy();
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    this.clear = () => this;
    this.emit('destroy', {});
    super.clear();
  }
}

/**
 * `fill:#fff,stroke:#000` -> {fill: '#fff', stroke: '#000'}.
 *
 * Splits only at top level: the commas inside `fill:rgba(0,0,0,.5)` or
 * `url("a,b")` belong to the value and stay in it. (A vocabulary never gets
 * this far with a functional colour — normalizeStates rewrites them to hex —
 * but this is a public export and takes arbitrary strings.)
 */
export function parseStyle(style) {
  const out = {};
  const parts = [];
  let current = '';
  let depth = 0;
  let quote = '';
  for (const ch of String(style || '')) {
    if (quote) { if (ch === quote) quote = ''; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  parts.push(current);
  for (const part of parts) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

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
import { StateStore } from './state.js';
import { Timeline } from './timeline.js';
import { Viewport } from './viewport.js';
import { Overlay } from './overlay.js';
export declare class LiveDiagram extends Emitter {
    options: {};
    graph: object;
    states: {};
    defaultState: any;
    showIcons: boolean;
    theme: any;
    renderer: any;
    store: StateStore;
    _nodes: Map<any, any>;
    _edges: Map<any, any>;
    _rendering: boolean;
    _pending: string;
    _destroyed: boolean;
    _sources: any[];
    _timelines: any[];
    _didAutoFit: boolean;
    _connection: string;
    _lastUpdate: number;
    _staleTimer: number;
    root: any;
    canvas: any;
    overlayLayer: any;
    scroller: any;
    overlays: Overlay;
    viewport: Viewport;
    _onClick: (event: any) => void;
    _onKey: (event: any) => void;
    _onOver: (event: any) => void;
    _hovered: any;
    _onOut: (event: any) => void;
    _everLive: boolean;
    _scheduled: boolean;
    _chain: any;
    _resizeObserver: ResizeObserver;
    _resizeTimer: number;
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
    constructor(options: {
        mount: Element | string;
        graph: import('./graph.js').GraphSpec;
        states?: object;
        initial?: object;
        renderer?: object;
        theme?: string;
        defaultState?: string;
        showIcons?: boolean;
        controls?: boolean;
        autoFit?: boolean | 'observe';
        strict?: boolean;
        viewport?: object | false;
    });
    _mountDom(mount: any): void;
    _mountControls(doc: any): void;
    _bindInteractions(): void;
    _edgePayload(id: any, event: any): {
        id: any;
        edge: any;
        from: any;
        to: any;
        state: string;
        data: object;
        element: any;
        originalEvent: any;
    };
    _nodePayload(id: any, event: any): {
        id: any;
        node: any;
        state: string;
        badge: string;
        data: object;
        element: any;
        originalEvent: any;
    };
    /**
     * The one way state changes.
     *
     * @param {import('./state.js').StatePatch} patch - {nodeId: 'state'} or {nodeId: {state, badge, data, merge}}
     * @returns {LiveDiagram}
     */
    patch(patch: import('./state.js').StatePatch): LiveDiagram;
    /**
     * Shorthand for a single node's state.
     * @param {string} id
     * @param {string} state
     */
    setState(id: string, state: string): LiveDiagram;
    /** Sets (or clears, with null) a node's badge. */
    badge(id: any, text: any): LiveDiagram;
    /** Attaches an arbitrary payload to a node; `merge` layers onto the previous. */
    data(id: any, payload: any, merge: any): LiveDiagram;
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
    overlay(id: string, content: Element | string | null, options?: object): Element | null;
    /** Removes every custom overlay (badges are state, and stay). */
    clearOverlays(): this;
    /** Every node back to the default state. */
    clear(): this;
    /** @returns {object} {states, badges, data} — safe to keep. */
    snapshot(): object;
    /** @returns {{state, badge, data}} */
    get(id: any): {
        state: any;
        badge: any;
        data: any;
    };
    /**
     * An edge's state. Edges are addressed as `from->to` (see `graph.edges[].id`).
     * @returns {{state, data}}
     */
    getEdge(id: any): {
        state: any;
        data: any;
    };
    /** Restores a snapshot wholesale (the primitive behind seek and diff). */
    restore(snapshot: any): this;
    /** Swaps the graph, keeping the state of nodes that still exist. */
    setGraph(graph: any): this;
    /** Swaps or extends the state vocabulary. */
    setStates(states: any, options: any): this;
    /** @param {string} theme - 'light' | 'dark' | 'auto' */
    setTheme(theme: string): this;
    zoom(scale: any): this;
    zoomIn(): this;
    zoomOut(): this;
    fit(padding: any): this;
    resetView(): this;
    /**
     * Builds a replay controller over a recorded event list.
     *
     * @param {Array<object>} events - [{t, node, state, badge?, data?}] or [{t, patch}]
     * @returns {Timeline}
     */
    timeline(events: Array<object>): Timeline;
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
    connect(source: object | Function, options?: object): Function;
    /**
     * 'live' | 'stale' | 'none'. Reflected on the root as `data-ld-connection`,
     * so a stale diagram can be dimmed in CSS without any JavaScript of yours.
     */
    get connection(): string;
    /** @returns {?number} When state last arrived, epoch ms. */
    get lastUpdate(): number | null;
    _setConnection(next: any, src: any): void;
    _armStaleTimer(staleAfter: any): void;
    /** @returns {string} The current renderer definition (handy for export/debug). */
    definition(): string;
    /** @returns {string} The current SVG markup. */
    svg(): string;
    _schedule(kind: any): void;
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
    render(): Promise<LiveDiagram>;
    _renderNow(): Promise<this>;
    /**
     * The fast path: repaint node styles on the existing SVG.
     *
     * Layout does not change when a node goes from running to success, so
     * re-parsing the whole diagram to recolour one box is waste — and worse, it
     * makes the canvas flash and drops the user's selection. Falls back to a
     * full render if the SVG is not there yet.
     */
    _restyle(): this | Promise<LiveDiagram>;
    /** Makes rendered nodes focusable, labelled and queryable from CSS. */
    _decorate(): void;
    /**
     * autoFit 'observe': debounced refit on container resize. Stopped forever by
     * the first hand zoom (see `onChange`); without ResizeObserver, fit-once.
     * fit() is silent when the scale is unchanged, so the refit's own scrollbar
     * wiggle cannot loop back through here.
     */
    _observeResize(): void;
    _stopObserving(): void;
    /** Detaches sources, timers, listeners and DOM. Safe to call twice. */
    destroy(): void;
}
/**
 * `fill:#fff,stroke:#000` -> {fill: '#fff', stroke: '#000'}.
 *
 * Splits only at top level: the commas inside `fill:rgba(0,0,0,.5)` or
 * `url("a,b")` belong to the value and stay in it. (A vocabulary never gets
 * this far with a functional colour — normalizeStates rewrites them to hex —
 * but this is a public export and takes arbitrary strings.)
 */
export declare function parseStyle(style: any): {};

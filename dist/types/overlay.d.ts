/**
 * The overlay layer: HTML anchored to nodes.
 *
 * Badges live here rather than in node labels for two practical reasons: a
 * label change means re-parsing and re-laying-out the whole diagram (nodes jump
 * around when a duration counter ticks), and text inside an SVG cannot be
 * styled by your stylesheet the way a div can.
 *
 * Once that machinery exists, a badge is just the smallest thing you can hang
 * on a node. `overlay()` opens it up: a progress bar, a sparkline, an avatar, a
 * retry button, a line of streaming output — anything you can put in a div,
 * positioned against a node and kept there through re-renders and zooms. The
 * library positions your element and never draws its contents.
 */
export declare class Overlay {
    layer: Element;
    scroller: Element;
    chips: Map<any, any>;
    items: Map<any, any>;
    /**
     * @param {Element} layer - Absolutely positioned element inside the scroller
     * @param {Element} scroller
     */
    constructor(layer: Element, scroller: Element);
    /**
     * Anchors an element to a node. Returns the element, because the caller
     * usually wants to keep updating it (a progress bar is not a one-shot).
     *
     * @param {string} id - Node id
     * @param {Element|string|null} content - Element, HTML string, or null to remove
     * @param {object} [options]
     * @param {string} [options.position='top-right'] - See ANCHORS
     * @param {Array<number>} [options.offset=[0,0]] - Extra pixels, [x, y]
     * @param {string} [options.className]
     * @param {boolean} [options.interactive=true] - Whether it receives pointer events
     * @returns {?Element}
     */
    set(id: string, content: Element | string | null, options?: {
        position?: string;
        offset?: Array<number>;
        className?: string;
        interactive?: boolean;
    }): Element | null;
    /** @returns {?Element} */
    get(id: any): Element | null;
    /** Removes every custom overlay, leaving badges alone. */
    clearItems(): void;
    /**
     * Repositions and rewrites every chip. Called after a render and after a
     * zoom; cheap enough to do wholesale for the node counts diagrams have.
     *
     * @param {Map<string, Element>} nodes
     * @param {object} badges - nodeId -> text
     */
    sync(nodes: Map<string, Element>, badges: object): void;
    clear(): void;
}

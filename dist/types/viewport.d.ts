/**
 * Zoom, fit and drag-to-pan.
 *
 * Small, boring, and rewritten by hand in every project that puts a diagram on
 * a page. That is precisely why it belongs in the library.
 *
 * Scaling resizes the SVG's element box (width, from the viewBox) rather than
 * transforming it — a transform scales pixels but not the layout box, so
 * centering and scrollbars work on the wrong size. Renders replace the SVG;
 * `resync()` re-projects `_scale` onto the new one.
 */
export declare class Viewport {
    scroller: Element;
    content: Element;
    min: number;
    max: number;
    step: number;
    maxFitScale: number;
    onChange: any;
    _scale: number;
    _teardown: any[];
    /**
     * @param {object} args
     * @param {Element} args.scroller - The overflow:auto element
     * @param {Element} args.content - The element that gets scaled
     * @param {object} [args.options]
     * @param {number} [args.options.min=0.3]
     * @param {number} [args.options.max=3]
     * @param {number} [args.options.step=0.15]
     * @param {boolean} [args.options.pan=true]
     * @param {boolean} [args.options.wheelZoom=true] - Ctrl/⌘ + wheel
     * @param {number} [args.options.maxFitScale=1.75] - How far fit() may upscale
     * @param {function(number, string=): void} [args.onChange] - Called with the
     *   new scale and its cause, 'zoom' or 'fit'. Never called by `resync()`.
     */
    constructor(args: {
        scroller: Element;
        content: Element;
        options?: {
            min?: number;
            max?: number;
            step?: number;
            pan?: boolean;
            wheelZoom?: boolean;
            maxFitScale?: number;
        };
    });
    get scale(): number;
    /** Writes the scale onto the mounted SVG's element box. Projection only. */
    _project(scale: any): void;
    /**
     * Re-projects the scale onto the SVG a full render just replaced. Silent
     * (no `onChange`) and unclamped — fit() may have stored a below-`min` value.
     */
    resync(): number;
    /** Sets the zoom level, clamped. */
    zoom(scale: any): number;
    zoomIn(): number;
    zoomOut(): number;
    reset(): number;
    /**
     * Scales the diagram to fill the scroller.
     *
     * Upscaling is allowed but capped (`maxFitScale`, 1.75 by default): a
     * four-node diagram stretched across a widescreen looks like a mistake,
     * while leaving it postage-stamp-sized in the corner looks like a bug.
     * Not floored at `min` (that bounds interactive zoom): fit's contract is
     * fitting, so it skips `zoom()` and fires `onChange` (cause 'fit') itself.
     */
    fit(padding: any): any;
    /** The loud half of fit(): cause 'fit', silent when nothing changes. */
    _fitTo(scale: any): any;
    _enablePan(): void;
    _enableWheelZoom(): void;
    destroy(): void;
}

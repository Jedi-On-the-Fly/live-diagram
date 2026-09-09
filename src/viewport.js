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

export class Viewport {
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
  constructor(args) {
    this.scroller = args.scroller;
    this.content = args.content;
    const o = args.options || {};
    this.min = o.min || 0.3;
    this.max = o.max || 3;
    this.step = o.step || 0.15;
    this.maxFitScale = o.maxFitScale == null ? 1.75 : Number(o.maxFitScale);
    this.onChange = args.onChange || (() => {});
    this._scale = 1;
    this._teardown = [];

    if (o.pan !== false) this._enablePan();
    if (o.wheelZoom !== false) this._enableWheelZoom();
  }

  get scale() { return this._scale; }

  /** Writes the scale onto the mounted SVG's element box. Projection only. */
  _project(scale) {
    if (this.content.style.transform) this.content.style.transform = '';
    const svg = this.content.querySelector('svg');
    const vb = svg && svg.viewBox && svg.viewBox.baseVal;
    if (!vb || !vb.width) return;
    svg.style.width = `${vb.width * scale}px`;
  }

  /**
   * Re-projects the scale onto the SVG a full render just replaced. Silent
   * (no `onChange`) and unclamped — fit() may have stored a below-`min` value.
   */
  resync() {
    this._project(this._scale);
    return this._scale;
  }

  /** Sets the zoom level, clamped. */
  zoom(scale) {
    const next = Math.max(this.min, Math.min(this.max, Number(scale) || 1));
    if (next === this._scale) return this._scale;
    this._scale = next;
    this._project(next);
    this.onChange(next, 'zoom');
    return next;
  }

  zoomIn() { return this.zoom(this._scale + this.step); }
  zoomOut() { return this.zoom(this._scale - this.step); }
  reset() { this.scroller.scrollLeft = 0; this.scroller.scrollTop = 0; return this.zoom(1); }

  /**
   * Scales the diagram to fill the scroller.
   *
   * Upscaling is allowed but capped (`maxFitScale`, 1.75 by default): a
   * four-node diagram stretched across a widescreen looks like a mistake,
   * while leaving it postage-stamp-sized in the corner looks like a bug.
   * Not floored at `min` (that bounds interactive zoom): fit's contract is
   * fitting, so it skips `zoom()` and fires `onChange` (cause 'fit') itself.
   */
  fit(padding) {
    const svg = this.content.querySelector('svg');
    const vb = svg && svg.viewBox && svg.viewBox.baseVal;
    if (!vb || !vb.width || !vb.height) return this._fitTo(1);
    const pad = padding == null ? 24 : padding;
    const scale = Math.min(
      (this.scroller.clientWidth - pad) / vb.width,
      (this.scroller.clientHeight - pad) / vb.height,
      this.maxFitScale
    );
    // A collapsed or hidden scroller has nothing to fit to. Change nothing:
    // snapping a hidden diagram to scale 1 is wrong, and emitting 'zoom' here
    // read as a hand zoom and permanently cancelled autoFit observation.
    if (!isFinite(scale) || scale <= 0) return this._scale;
    this.scroller.scrollLeft = 0;
    this.scroller.scrollTop = 0;
    return this._fitTo(scale);
  }

  /** The loud half of fit(): cause 'fit', silent when nothing changes. */
  _fitTo(scale) {
    if (scale === this._scale) return this._scale;
    this._scale = scale;
    this._project(scale);
    this.onChange(scale, 'fit');
    return scale;
  }

  _enablePan() {
    const onDown = (e) => {
      if (e.button !== 0) return;
      // Let a click on a node be a click, not the start of a drag.
      if (e.target && e.target.closest && e.target.closest('[data-ld-node]')) return;
      const startX = e.clientX, startY = e.clientY;
      const sl = this.scroller.scrollLeft, st = this.scroller.scrollTop;
      const move = (ev) => {
        this.scroller.scrollLeft = sl - (ev.clientX - startX);
        this.scroller.scrollTop = st - (ev.clientY - startY);
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        this.scroller.classList.remove('is-panning');
      };
      this.scroller.classList.add('is-panning');
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };
    this.scroller.addEventListener('mousedown', onDown);
    this._teardown.push(() => this.scroller.removeEventListener('mousedown', onDown));
  }

  _enableWheelZoom() {
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return; // plain wheel keeps scrolling the page
      e.preventDefault();
      this.zoom(this._scale + (e.deltaY < 0 ? this.step : -this.step));
    };
    this.scroller.addEventListener('wheel', onWheel, { passive: false });
    this._teardown.push(() => this.scroller.removeEventListener('wheel', onWheel));
  }

  destroy() {
    this._teardown.forEach((fn) => fn());
    this._teardown = [];
  }
}

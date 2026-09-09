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

/** Anchor points, as fractions of the node's box. */
const ANCHORS = {
  'top-left': [0, 0],
  top: [0.5, 0],
  'top-right': [1, 0],
  left: [0, 0.5],
  center: [0.5, 0.5],
  right: [1, 0.5],
  'bottom-left': [0, 1],
  bottom: [0.5, 1],
  'bottom-right': [1, 1]
};

export class Overlay {
  /**
   * @param {Element} layer - Absolutely positioned element inside the scroller
   * @param {Element} scroller
   */
  constructor(layer, scroller) {
    this.layer = layer;
    this.scroller = scroller;
    this.chips = new Map();
    this.items = new Map();
  }

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
  set(id, content, options) {
    const existing = this.items.get(id);
    if (content == null) {
      if (existing) { existing.el.remove(); this.items.delete(id); }
      return null;
    }
    const opts = options || {};
    let el = content;
    if (typeof content === 'string') {
      el = this.layer.ownerDocument.createElement('div');
      el.innerHTML = content;
    }
    if (existing && existing.el !== el) existing.el.remove();

    el.classList.add('ld-overlay-item');
    if (opts.className) el.classList.add(...String(opts.className).split(/\s+/).filter(Boolean));
    el.setAttribute('data-ld-overlay-for', id);
    // The layer ignores pointer events so the diagram underneath stays
    // clickable; an overlay opts back in, which is what makes buttons work.
    el.style.pointerEvents = opts.interactive === false ? 'none' : 'auto';
    if (!el.parentNode) this.layer.appendChild(el);

    this.items.set(id, { el, position: ANCHORS[opts.position] ? opts.position : 'top-right', offset: opts.offset || [0, 0] });
    return el;
  }

  /** @returns {?Element} */
  get(id) {
    const entry = this.items.get(id);
    return entry ? entry.el : null;
  }

  /** Removes every custom overlay, leaving badges alone. */
  clearItems() {
    for (const entry of this.items.values()) entry.el.remove();
    this.items.clear();
  }

  /**
   * Repositions and rewrites every chip. Called after a render and after a
   * zoom; cheap enough to do wholesale for the node counts diagrams have.
   *
   * @param {Map<string, Element>} nodes
   * @param {object} badges - nodeId -> text
   */
  sync(nodes, badges) {
    const wanted = new Set(Object.keys(badges || {}));

    for (const [id, chip] of Array.from(this.chips)) {
      if (!wanted.has(id)) { chip.remove(); this.chips.delete(id); }
    }
    if (!wanted.size && !this.items.size) return;

    const base = this.scroller.getBoundingClientRect();

    // Custom overlays: same geometry, arbitrary content, chosen anchor.
    for (const [id, entry] of this.items) {
      const el = nodes.get(id);
      if (!el) { entry.el.style.display = 'none'; continue; }
      entry.el.style.display = '';
      const rect = el.getBoundingClientRect();
      const [fx, fy] = ANCHORS[entry.position];
      const x = rect.left + rect.width * fx - base.left + (this.scroller.scrollLeft || 0) + entry.offset[0];
      const y = rect.top + rect.height * fy - base.top + (this.scroller.scrollTop || 0) + entry.offset[1];
      entry.el.style.left = `${Math.round(x)}px`;
      entry.el.style.top = `${Math.round(y)}px`;
    }

    for (const id of wanted) {
      const el = nodes.get(id);
      if (!el) continue;
      let chip = this.chips.get(id);
      if (!chip) {
        chip = this.layer.ownerDocument.createElement('span');
        chip.className = 'ld-badge';
        chip.setAttribute('data-ld-badge-for', id);
        this.layer.appendChild(chip);
        this.chips.set(id, chip);
      }
      chip.textContent = badges[id];
      const rect = el.getBoundingClientRect();
      // `scroller` is the host element in bare mode, where scroll offsets are 0.
      const x = rect.right - base.left + (this.scroller.scrollLeft || 0);
      const y = rect.top - base.top + (this.scroller.scrollTop || 0);
      chip.style.left = `${Math.round(x - 6)}px`;
      chip.style.top = `${Math.round(y - 6)}px`;
    }
  }

  clear() {
    for (const chip of this.chips.values()) chip.remove();
    this.chips.clear();
    this.clearItems();
  }
}

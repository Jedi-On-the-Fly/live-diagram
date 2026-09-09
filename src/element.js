/**
 * `<live-diagram>` — the custom element.
 *
 * A class is the honest core, but "import it, hold a ref, mount it in an
 * effect, destroy it on unmount" is four decisions before anyone sees a
 * diagram. One custom element works unchanged in React, Vue, Svelte, Astro,
 * Rails, Django, WordPress and every documentation site, which makes it the
 * cheapest integration this library can offer.
 *
 * Deliberately light DOM, not shadow DOM: the stylesheet, your own CSS
 * overrides and Mermaid's rendering all reach the diagram normally, and
 * `document.querySelector('[data-ld-node="build"]')` keeps working.
 */

import { LiveDiagram } from './live-diagram.js';
import { looksLikeMermaid } from './parse-mermaid.js';

const BOOLEAN_ATTRS = ['controls', 'icons', 'bare', 'no-fit'];

/**
 * Parses an attribute that may be inline JSON, a `#selector` pointing at a
 * script tag, or — for `graph` — plain Mermaid source.
 */
export function readJsonAttr(el, name, allowMermaid) {
  const raw = el.getAttribute(name);
  if (!raw) return null;
  const value = raw.trim();
  if (value.startsWith('#')) {
    const source = el.ownerDocument.querySelector(value);
    if (!source) throw new Error(`<live-diagram> ${name}="${value}" — no such element`);
    const text = source.textContent.trim();
    try { return JSON.parse(text); } catch (err) {
      if (allowMermaid && looksLikeMermaid(text)) return text;
      throw err;
    }
  }
  try {
    return JSON.parse(value);
  } catch (err) {
    if (allowMermaid && looksLikeMermaid(value)) return value;   // Mermaid source, handed on as-is
    throw new Error(`<live-diagram> ${name} is not valid JSON: ${err.message}`);
  }
}

/**
 * Defines the element. Called automatically by the UMD build (the drop-in-a-page
 * path); ESM users call it themselves so importing the library stays free of
 * side effects.
 *
 * @param {string} [tagName='live-diagram']
 * @param {object} [globalScope] - Where to find customElements (tests pass a stub)
 * @returns {?Function} The element class, or null if it was already defined.
 */
export function defineLiveDiagram(tagName, globalScope) {
  const scope = globalScope || (typeof globalThis !== 'undefined' ? globalThis : null);
  const name = tagName || 'live-diagram';
  if (!scope || !scope.customElements || !scope.HTMLElement) return null;
  if (scope.customElements.get(name)) return scope.customElements.get(name);

  class LiveDiagramElement extends scope.HTMLElement {
    static get observedAttributes() { return ['graph', 'states', 'theme', 'src', 'height']; }

    constructor() {
      super();
      this.diagram = null;
      this._mounting = false;
    }

    connectedCallback() {
      if (!this.style.height && !this.getAttribute('height')) this.style.height = '420px';
      else if (this.getAttribute('height')) this.style.height = this.getAttribute('height');
      this.style.display = this.style.display || 'block';
      this._mount();
    }

    disconnectedCallback() {
      if (this.diagram) { this.diagram.destroy(); this.diagram = null; }
    }

    attributeChangedCallback(name, before, after) {
      if (before === after || !this.isConnected) return;
      if (name === 'theme' && this.diagram) { this.diagram.setTheme(after || 'auto'); return; }
      if (name === 'height') { this.style.height = after || '420px'; return; }
      this._mount();  // graph / states / src changed: rebuild
    }

    // ---- the class API, forwarded so the element is not a dead end ----------
    patch(patch) { return this.diagram && this.diagram.patch(patch); }
    setState(id, state) { return this.diagram && this.diagram.setState(id, state); }
    badge(id, text) { return this.diagram && this.diagram.badge(id, text); }
    snapshot() { return this.diagram && this.diagram.snapshot(); }
    restore(snapshot) { return this.diagram && this.diagram.restore(snapshot); }
    clear() { return this.diagram && this.diagram.clear(); }
    fit() { return this.diagram && this.diagram.fit(); }
    timeline(events) { return this.diagram && this.diagram.timeline(events); }
    connect(source) { return this.diagram && this.diagram.connect(source); }

    /** @param {object} graph - Set the graph as a property (no JSON round-trip). */
    set graph(graph) { this._graph = graph; if (this.isConnected) this._mount(); }
    get graph() { return this._graph || (this.diagram && this.diagram.graph) || null; }

    set states(states) { this._states = states; if (this.isConnected) this._mount(); }
    get states() { return this._states || null; }

    async _mount() {
      if (this._mounting) return;
      this._mounting = true;
      try {
        let graph = this._graph || readJsonAttr(this, 'graph', true);
        let states = this._states || readJsonAttr(this, 'states');
        let initial = readJsonAttr(this, 'initial');
        let events = null;

        const src = this.getAttribute('src');
        if (src) {
          const response = await fetch(src, { credentials: 'same-origin' });
          if (!response.ok) throw new Error(`<live-diagram src="${src}"> responded ${response.status}`);
          const payload = await response.json();
          // The file may be a bare graph or a full spec.
          graph = payload.graph || (payload.nodes ? payload : graph);
          states = payload.states || states;
          initial = payload.initial || initial;
          events = payload.events || null;
        }

        if (!graph) throw new Error('<live-diagram> needs a `graph` attribute, a `src`, or a .graph property');

        if (this.diagram) this.diagram.destroy();
        this.innerHTML = '';

        const flags = {};
        for (const attr of BOOLEAN_ATTRS) flags[attr] = this.hasAttribute(attr);

        this.diagram = new LiveDiagram({
          mount: this,
          graph: (this.getAttribute('direction') && typeof graph === 'object')
            ? { ...graph, direction: this.getAttribute('direction') } : graph,
          states,
          initial,
          theme: this.getAttribute('theme') || 'auto',
          defaultState: this.getAttribute('default-state') || undefined,
          controls: flags.controls,
          showIcons: flags.icons,
          autoFit: flags['no-fit'] ? false : (this.getAttribute('fit') === 'observe' ? 'observe' : true),
          viewport: flags.bare ? false : undefined
        });

        // DOM events, so a listener can be attached from anywhere — including
        // frameworks that never import this library.
        this.diagram.on('nodeClick', (detail) => this._emit('nodeclick', detail));
        this.diagram.on('nodeHover', (detail) => this._emit('nodehover', detail));
        this.diagram.on('change', (detail) => this._emit('statechange', detail));
        this.diagram.on('error', (detail) => this._emit('diagramerror', detail));

        if (events) {
          this.replay = this.diagram.timeline(events);
          if (this.hasAttribute('autoplay')) {
            this.replay.play({ speed: Number(this.getAttribute('speed')) || 1, loop: this.hasAttribute('loop') });
          } else {
            this.replay.seek(this.replay.duration);
          }
        }

        await this.diagram.render();
        this._emit('ready', { diagram: this.diagram });
      } catch (err) {
        this._emit('diagramerror', { source: 'element', error: err });
        // Say so in the page rather than only in the console: a silent empty
        // box is the worst possible failure for a copy-pasted snippet.
        this.innerHTML = `<pre style="margin:0;padding:12px;font:12px ui-monospace,monospace;color:#b91c1c;white-space:pre-wrap">${
          String(err && err.message || err).replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</pre>`;
      } finally {
        this._mounting = false;
      }
    }

    _emit(name, detail) {
      this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
    }
  }

  scope.customElements.define(name, LiveDiagramElement);
  return LiveDiagramElement;
}

/**
 * A legend, built from the state vocabulary the diagram already holds.
 *
 * Every demo written against this library hand-rolled one of these, which is
 * the clearest possible signal that it belongs here. It is opt-in: the core
 * renders diagrams, and none of the kit is loaded into a page that never calls
 * it.
 */

import { parseStyle } from '../live-diagram.js';
import { resolveTheme } from '../renderers/mermaid.js';
import { styleFor } from '../states.js';

/**
 * @param {object} diagram - A LiveDiagram
 * @param {object} [options]
 * @param {Element|string} [options.mount] - Where to put it (else use `.el` yourself)
 * @param {boolean} [options.counts=true] - Show how many nodes are in each state
 * @param {boolean} [options.hideUnused=false] - Only show states in use
 * @param {Array<string>} [options.only] - Restrict to these state names, in this order
 * @returns {{el: Element, update: function, destroy: function}}
 */
export function legend(diagram, options) {
  const opts = options || {};
  const doc = diagram.root.ownerDocument;
  const el = doc.createElement('div');
  el.className = 'ld-legend';

  const update = () => {
    const theme = resolveTheme(diagram.theme);
    const snapshot = diagram.snapshot();
    const tally = {};
    for (const state of Object.values(snapshot.states)) tally[state] = (tally[state] || 0) + 1;

    const names = opts.only || Object.keys(diagram.states);
    el.innerHTML = '';
    for (const name of names) {
      const entry = diagram.states[name];
      if (!entry) continue;
      const count = tally[name] || 0;
      if (opts.hideUnused && !count) continue;

      const declarations = parseStyle(styleFor(diagram.states, name, theme));
      const item = doc.createElement('span');
      item.className = 'ld-legend__item';
      item.setAttribute('data-ld-legend-state', name);

      const swatch = doc.createElement('i');
      swatch.className = 'ld-legend__swatch';
      swatch.style.background = declarations.fill || 'transparent';
      swatch.style.borderColor = declarations.stroke || 'currentColor';
      item.appendChild(swatch);
      item.appendChild(doc.createTextNode(entry.label || name));

      if (opts.counts !== false) {
        const badge = doc.createElement('b');
        badge.textContent = String(count);
        item.appendChild(badge);
      }
      el.appendChild(item);
    }
  };

  const offs = [
    diagram.on('change', update),
    diagram.on('render', update),
    diagram.on('restyle', update)
  ];
  update();

  const mount = typeof opts.mount === 'string' ? doc.querySelector(opts.mount) : opts.mount;
  if (mount) mount.appendChild(el);

  return {
    el,
    update,
    destroy() {
      offs.forEach((off) => off());
      if (el.parentNode) el.parentNode.removeChild(el);
    }
  };
}

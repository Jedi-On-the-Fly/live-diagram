/**
 * An inspector: what the thing under the pointer, or the thing you just
 * clicked, actually is.
 *
 * Four demos, four hand-written detail panels — all showing the same five
 * fields the payload already carries. This is that panel, with the template
 * exposed so it can be replaced rather than fought.
 */

const FIELD_ORDER = ['state', 'badge', 'description', 'data'];

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** The default template: a definition list of what is known. */
export function defaultTemplate(payload) {
  if (!payload) return '';
  const rows = [];
  if (payload.edge) {
    rows.push(['edge', `${payload.from} → ${payload.to}`]);
    rows.push(['state', payload.state]);
    if (payload.edge.label) rows.push(['label', payload.edge.label]);
  } else {
    rows.push(['node', payload.node && payload.node.label ? payload.node.label : payload.id]);
    for (const field of FIELD_ORDER) {
      const value = field === 'description' ? (payload.node && payload.node.description) : payload[field];
      if (value == null || value === '') continue;
      rows.push([field, typeof value === 'object' ? JSON.stringify(value) : value]);
    }
  }
  return rows.map(([key, value]) =>
    `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join('');
}

/**
 * @param {object} diagram - A LiveDiagram
 * @param {object} [options]
 * @param {'panel'|'tooltip'} [options.mode='panel']
 * @param {Element|string} [options.mount] - Required for 'panel'; ignored for 'tooltip'
 * @param {function(object): string} [options.template] - Return HTML for a payload
 * @param {string} [options.empty='Click a node.'] - Panel text with nothing selected
 * @param {boolean} [options.edges=true] - Also inspect edges
 * @returns {{el: Element, show: function, destroy: function}}
 */
export function inspector(diagram, options) {
  const opts = options || {};
  const mode = opts.mode === 'tooltip' ? 'tooltip' : 'panel';
  const doc = diagram.root.ownerDocument;
  const template = opts.template || defaultTemplate;

  const el = doc.createElement('dl');
  el.className = `ld-inspector ld-inspector--${mode}`;
  if (mode === 'tooltip') el.hidden = true;

  const show = (payload) => {
    if (!payload) {
      if (mode === 'tooltip') { el.hidden = true; return; }
      el.innerHTML = `<dt>—</dt><dd>${escapeHtml(opts.empty || 'Click a node.')}</dd>`;
      return;
    }
    el.innerHTML = template(payload);
    if (mode === 'tooltip') {
      el.hidden = false;
      position(payload);
    }
  };

  /** Keeps the tooltip beside its node and inside the diagram. */
  function position(payload) {
    const target = payload.element;
    if (!target) return;
    const base = diagram.root.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    const width = el.offsetWidth || 200;
    let left = rect.left - base.left + rect.width / 2 - width / 2;
    left = Math.max(4, Math.min(base.width - width - 4, left));
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(rect.bottom - base.top + 8)}px`;
  }

  const offs = [];
  if (mode === 'tooltip') {
    diagram.root.appendChild(el);
    offs.push(diagram.on('nodeHover', show));
  } else {
    offs.push(diagram.on('nodeClick', show));
  }
  if (opts.edges !== false) offs.push(diagram.on('edgeClick', show));
  // A rebuilt diagram means the element the tooltip pointed at is gone.
  offs.push(diagram.on('render', () => { if (mode === 'tooltip') el.hidden = true; }));

  show(null);

  const mount = typeof opts.mount === 'string' ? doc.querySelector(opts.mount) : opts.mount;
  if (mount && mode === 'panel') mount.appendChild(el);

  return {
    el,
    show,
    destroy() {
      offs.forEach((off) => off());
      if (el.parentNode) el.parentNode.removeChild(el);
    }
  };
}

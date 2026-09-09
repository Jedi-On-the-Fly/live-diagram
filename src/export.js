/**
 * Getting a diagram back out: as a file, or as a link.
 *
 * A diagram that only exists in a browser tab is half a tool. People put these
 * in incident reports, in slide decks, and in messages to colleagues — and
 * "screenshot it" loses the crispness, the badges and the state at the same
 * time.
 *
 * Two honest limitations, both stated rather than papered over: badges and
 * overlays are HTML, so an SVG export redraws badges in SVG and cannot carry
 * arbitrary overlay content; and PNG rasterisation cannot render Mermaid's
 * default HTML labels (see `toPNG`).
 */

const XMLNS = 'http://www.w3.org/2000/svg';

/** Serialises the rendered SVG, standalone and self-contained. */
function cloneSvg(diagram) {
  const svg = diagram.canvas && diagram.canvas.querySelector('svg');
  if (!svg) throw new Error('live-diagram: nothing rendered yet — await diagram.render() first');
  const clone = svg.cloneNode(true);
  const box = svg.getBoundingClientRect();
  const scale = diagram.viewport ? (diagram.viewport.scale || 1) : 1;
  // The on-page SVG carries the zoom projection as an inline width; an export
  // is standalone and must not inherit the viewer's zoom level.
  clone.style.removeProperty('width');
  if (!clone.getAttribute('style')) clone.removeAttribute('style');
  clone.setAttribute('xmlns', XMLNS);
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  // Mermaid sizes its SVG with a viewBox and a percentage width; an exported
  // file needs real dimensions or every consumer guesses differently.
  if (!clone.getAttribute('viewBox') && svg.viewBox && svg.viewBox.baseVal) {
    const v = svg.viewBox.baseVal;
    clone.setAttribute('viewBox', `${v.x} ${v.y} ${v.width} ${v.height}`);
  }
  clone.setAttribute('width', Math.round(box.width / scale));
  clone.setAttribute('height', Math.round(box.height / scale));
  return { svg, clone };
}

/** The node's box in the root SVG's coordinate system. */
function boxInSvgSpace(el) {
  const box = el.getBBox();
  const ctm = el.getCTM();
  if (!ctm) return null;
  const point = (x, y) => ({ x: ctm.a * x + ctm.c * y + ctm.e, y: ctm.b * x + ctm.d * y + ctm.f });
  const topLeft = point(box.x, box.y);
  const bottomRight = point(box.x + box.width, box.y + box.height);
  return { x: topLeft.x, y: topLeft.y, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y };
}

/** Redraws badge chips as SVG, since the originals are HTML. */
function drawBadges(diagram, clone) {
  const badges = diagram.snapshot().badges;
  const ids = Object.keys(badges || {});
  if (!ids.length) return;
  const doc = clone.ownerDocument;
  const layer = doc.createElementNS(XMLNS, 'g');
  layer.setAttribute('class', 'ld-export-badges');

  for (const id of ids) {
    const el = diagram._nodes.get(id);
    if (!el) continue;
    const box = boxInSvgSpace(el);
    if (!box) continue;
    const text = String(badges[id]);
    const width = Math.max(22, text.length * 6.6 + 12);
    const height = 17;
    const x = box.x + box.width - width / 2;
    const y = box.y - height / 2;

    const rect = doc.createElementNS(XMLNS, 'rect');
    rect.setAttribute('x', x); rect.setAttribute('y', y);
    rect.setAttribute('rx', height / 2);
    rect.setAttribute('width', width); rect.setAttribute('height', height);
    rect.setAttribute('fill', '#0f172a');

    const label = doc.createElementNS(XMLNS, 'text');
    label.setAttribute('x', x + width / 2); label.setAttribute('y', y + height / 2 + 4);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace');
    label.setAttribute('font-size', '11');
    label.setAttribute('font-weight', '600');
    label.setAttribute('fill', '#f8fafc');
    label.textContent = text;

    layer.appendChild(rect);
    layer.appendChild(label);
  }
  clone.appendChild(layer);
}

/**
 * The diagram as a standalone SVG string.
 *
 * @param {object} diagram - A LiveDiagram
 * @param {object} [options]
 * @param {string} [options.background] - A colour behind the diagram (default: transparent)
 * @param {boolean} [options.badges=true] - Redraw badge chips into the SVG
 * @returns {string}
 */
export function toSVG(diagram, options) {
  const opts = options || {};
  const { clone } = cloneSvg(diagram);

  if (opts.background) {
    const doc = clone.ownerDocument;
    const rect = doc.createElementNS(XMLNS, 'rect');
    rect.setAttribute('x', '0'); rect.setAttribute('y', '0');
    rect.setAttribute('width', '100%'); rect.setAttribute('height', '100%');
    rect.setAttribute('fill', opts.background);
    clone.insertBefore(rect, clone.firstChild);
  }
  if (opts.badges !== false) drawBadges(diagram, clone);

  const markup = new XMLSerializer().serializeToString(clone);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${markup}`;
}

/**
 * The diagram as a PNG blob.
 *
 * Mermaid renders node labels as HTML inside `<foreignObject>` by default, and
 * no browser rasterises foreignObject when an SVG is drawn to a canvas — the
 * labels would silently vanish. Rather than ship an export that quietly loses
 * every word, this refuses and says how to fix it.
 *
 * @param {object} diagram
 * @param {object} [options]
 * @param {number} [options.scale=2]
 * @param {string} [options.background='#ffffff']
 * @returns {Promise<Blob>}
 */
export function toPNG(diagram, options) {
  const opts = options || {};
  const svgEl = diagram.canvas && diagram.canvas.querySelector('svg');
  if (svgEl && svgEl.querySelector('foreignObject')) {
    throw new Error(
      'live-diagram: this diagram uses Mermaid HTML labels, which cannot be rasterised. ' +
      'Render it with mermaidRenderer({ svgLabels: true }) to export PNG, ' +
      'or use toSVG(), which keeps them.'
    );
  }

  const scale = Number(opts.scale) > 0 ? Number(opts.scale) : 2;
  const markup = toSVG(diagram, { ...opts, background: opts.background || '#ffffff' });
  const { clone } = cloneSvg(diagram);
  const width = Number(clone.getAttribute('width')) || 800;
  const height = Number(clone.getAttribute('height')) || 600;

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('live-diagram: canvas produced no image'))), 'image/png');
    };
    image.onerror = () => reject(new Error('live-diagram: the SVG could not be rasterised'));
    // No external references are ever inlined, so the canvas stays untainted.
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
}

/**
 * Saves the diagram as a file.
 *
 * A page inside a sandboxed viewer (a Claude artifact, some embeds) blocks
 * downloads it did not initiate; there the honest move is to hand the caller
 * `toSVG()` and let them copy it.
 *
 * @param {object} diagram
 * @param {object} [options] - {format: 'svg'|'png', filename, ...toSVG/toPNG options}
 * @returns {Promise<void>}
 */
export async function download(diagram, options) {
  const opts = options || {};
  const format = opts.format === 'png' ? 'png' : 'svg';
  const name = opts.filename || `diagram.${format}`;
  const blob = format === 'png'
    ? await toPNG(diagram, opts)
    : new Blob([toSVG(diagram, opts)], { type: 'image/svg+xml;charset=utf-8' });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---------------------------------------------------------------- share links

/** URL-safe base64 that survives non-ASCII labels. */
function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64(text) {
  const padded = String(text).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Encodes anything JSON-able into a URL-safe string.
 * @param {object} payload
 * @returns {string}
 */
export function encodeState(payload) {
  return encodeBase64(JSON.stringify(payload));
}

/**
 * The inverse. Returns null for anything it cannot read, because a mangled
 * link should land on the default view rather than on an error.
 * @param {string} text
 * @returns {?object}
 */
export function decodeState(text) {
  if (!text) return null;
  try {
    return JSON.parse(decodeBase64(String(text).replace(/^#/, '')));
  } catch (_) {
    return null;
  }
}

/**
 * "Send someone this exact diagram, in this exact state."
 *
 * @param {object} diagram
 * @param {object} [options]
 * @param {string|object} [options.graph] - Prefer the Mermaid source you started from; it is
 *   far shorter than the expanded graph and is what a human would want to read
 * @param {string} [options.url] - Base URL (defaults to the current location)
 * @returns {string}
 */
export function shareUrl(diagram, options) {
  const opts = options || {};
  const snapshot = diagram.snapshot();
  const payload = {
    graph: opts.graph || { direction: diagram.graph.direction, nodes: diagram.graph.nodes, edges: diagram.graph.edges, groups: diagram.graph.groups },
    states: snapshot.states,
    edges: snapshot.edges,
    badges: snapshot.badges
  };
  const base = (opts.url || (typeof location !== 'undefined' ? location.href : '')).split('#')[0];
  return `${base}#${encodeState(payload)}`;
}

/**
 * Reads a payload written by `shareUrl` and applies it.
 * @param {object} diagram
 * @param {string} [hash] - Defaults to the current location hash
 * @returns {boolean} Whether anything was applied
 */
export function applyShared(diagram, hash) {
  const payload = decodeState(hash == null ? (typeof location !== 'undefined' ? location.hash : '') : hash);
  if (!payload || !payload.graph) return false;
  diagram.setGraph(payload.graph);
  diagram.restore({ states: payload.states || {}, edges: payload.edges || {}, badges: payload.badges || {} });
  return true;
}

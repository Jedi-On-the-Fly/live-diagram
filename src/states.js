/**
 * The state vocabulary: a status is a name, and a name maps to a visual
 * treatment. Declaratively, in data — not as a switch statement inside a
 * render function.
 *
 * This is the single idea most worth stealing from this library. Once "how a
 * running node looks" is config, a design change is a config change, a new
 * status is a new key, and the renderer never grows a branch.
 */

/**
 * A usable default vocabulary, so `new LiveDiagram({graph})` draws something
 * sensible before you have made any decisions. Every entry carries a light and
 * a dark treatment; the renderer picks one.
 */
export const DEFAULT_STATES = {
  idle:    { icon: '○', label: 'Idle',    style: 'fill:#f1f5f9,stroke:#94a3b8,color:#475569',
             darkStyle: 'fill:#1e293b,stroke:#64748b,color:#94a3b8',
             edgeStyle: 'stroke:#94a3b8', darkEdgeStyle: 'stroke:#475569' },
  queued:  { icon: '◌', label: 'Queued',  style: 'fill:#eef2ff,stroke:#a5b4fc,color:#4338ca',
             darkStyle: 'fill:#1e1b4b,stroke:#818cf8,color:#c7d2fe',
             edgeStyle: 'stroke:#a5b4fc', darkEdgeStyle: 'stroke:#818cf8' },
  running: { icon: '▶', label: 'Running', style: 'fill:#fef9c3,stroke:#ca8a04,color:#713f12',
             darkStyle: 'fill:#854d0e,stroke:#facc15,color:#fef9c3',
             edgeStyle: 'stroke:#ca8a04,stroke-width:2px', darkEdgeStyle: 'stroke:#facc15,stroke-width:2px' },
  waiting: { icon: '⏸', label: 'Waiting', style: 'fill:#e0e7ff,stroke:#6366f1,color:#3730a3',
             darkStyle: 'fill:#312e81,stroke:#818cf8,color:#c7d2fe',
             edgeStyle: 'stroke:#6366f1', darkEdgeStyle: 'stroke:#818cf8' },
  success: { icon: '✓', label: 'Success', style: 'fill:#dcfce7,stroke:#16a34a,color:#14532d',
             darkStyle: 'fill:#14532d,stroke:#4ade80,color:#bbf7d0',
             edgeStyle: 'stroke:#16a34a,stroke-width:2px', darkEdgeStyle: 'stroke:#4ade80,stroke-width:2px' },
  error:   { icon: '✗', label: 'Error',   style: 'fill:#fee2e2,stroke:#dc2626,color:#7f1d1d',
             darkStyle: 'fill:#7f1d1d,stroke:#f87171,color:#fecaca',
             edgeStyle: 'stroke:#dc2626,stroke-width:2px', darkEdgeStyle: 'stroke:#f87171,stroke-width:2px' },
  skipped: { icon: '↷', label: 'Skipped', style: 'fill:#f8fafc,stroke:#cbd5e1,color:#94a3b8',
             darkStyle: 'fill:#1e293b,stroke:#475569,color:#64748b',
             edgeStyle: 'stroke:#cbd5e1,stroke-dasharray:3 4', darkEdgeStyle: 'stroke:#475569,stroke-dasharray:3 4' }
};

/**
 * Rewrites `rgb()` / `rgba()` / `hsl()` / `hsla()` colours in a style string
 * to hex.
 *
 * Two parsers downstream cannot take the functional forms: Mermaid's style
 * grammar splits declarations on commas and refuses `fill:rgba(255,0,0,.5)`
 * outright (8-digit hex passes), and this library's own repaint path splits
 * the same way. Hex says the same thing and survives both, so the conversion
 * happens once, here, and nothing downstream ever meets a comma inside a
 * colour. A colour that cannot be converted — `var()`, a `turn` hue — is left
 * exactly as written rather than half-translated.
 *
 * @param {?string} style - A comma-separated style string
 * @returns {string}
 */
export function hexifyColors(style) {
  return String(style || '').replace(/\b(rgba?|hsla?)\(([^()]*)\)/gi, (whole, fn, body) => {
    const parts = body.split(/[,\s/]+/).filter((p) => p !== '');
    if (parts.length < 3 || parts.length > 4) return whole;
    const channel = (raw, scale) => {
      const value = raw.endsWith('%') ? (parseFloat(raw) / 100) * scale : parseFloat(raw);
      return Number.isFinite(value) ? Math.min(Math.max(value, 0), scale) : NaN;
    };
    let rgb;
    if (fn.toLowerCase().startsWith('rgb')) {
      rgb = [channel(parts[0], 255), channel(parts[1], 255), channel(parts[2], 255)];
    } else {
      if (/turn|rad/i.test(parts[0])) return whole;   // only degree hues are worth the code
      const h = ((parseFloat(parts[0]) % 360) + 360) % 360;
      const s = channel(parts[1], 100) / 100;
      const l = channel(parts[2], 100) / 100;
      if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) return whole;
      const f = (n) => {
        const k = (n + h / 30) % 12;
        return (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
      };
      rgb = [f(0), f(8), f(4)];
    }
    const alpha = parts.length === 4 ? channel(parts[3], 1) : 1;
    if (rgb.some((v) => !Number.isFinite(v)) || !Number.isFinite(alpha)) return whole;
    const hex = (v) => Math.round(v).toString(16).padStart(2, '0');
    return `#${rgb.map(hex).join('')}${alpha < 1 ? hex(alpha * 255) : ''}`;
  });
}

/**
 * Merges a caller's vocabulary over the defaults.
 *
 * Passing `{running: {style: '…'}}` overrides one treatment and keeps the rest;
 * passing `{extend: false}` in options starts from an empty vocabulary instead.
 *
 * @param {?object} states
 * @param {object} [options]
 * @param {boolean} [options.extend=true]
 */
export function normalizeStates(states, options) {
  const extend = !options || options.extend !== false;
  const base = extend ? DEFAULT_STATES : {};
  const out = {};
  for (const name of Object.keys(base)) out[name] = { ...base[name] };
  for (const name of Object.keys(states || {})) {
    const raw = states[name] || {};
    const entry = typeof raw === 'string' ? { style: raw } : raw;
    out[name] = { ...(out[name] || {}), ...entry };
  }
  for (const name of Object.keys(out)) {
    const e = out[name];
    e.icon = e.icon == null ? '' : String(e.icon);
    e.label = e.label == null ? name : String(e.label);
    e.style = e.style == null ? '' : hexifyColors(e.style);
    e.class = e.class == null ? '' : String(e.class);
    e.darkStyle = e.darkStyle == null ? e.style : hexifyColors(e.darkStyle);
    // An edge treatment is optional: a vocabulary that only describes nodes
    // borrows the node's stroke, which is the colour a reader already
    // associates with that state. The styles are hex by this point, so the
    // capture cannot stop halfway through an rgba().
    if (e.edgeStyle == null) {
      const stroke = /stroke:\s*([^,;]+)/.exec(e.style);
      e.edgeStyle = stroke ? `stroke:${stroke[1].trim()}` : '';
    } else {
      e.edgeStyle = hexifyColors(e.edgeStyle);
    }
    if (e.darkEdgeStyle == null) {
      const stroke = /stroke:\s*([^,;]+)/.exec(e.darkStyle);
      e.darkEdgeStyle = stroke ? `stroke:${stroke[1].trim()}` : e.edgeStyle;
    } else {
      e.darkEdgeStyle = hexifyColors(e.darkEdgeStyle);
    }
  }
  return out;
}

/**
 * Resolves the EDGE style string for a state under a theme.
 * @param {object} states - Normalized vocabulary
 * @param {string} name
 * @param {string} theme - 'light' | 'dark'
 */
export function edgeStyleFor(states, name, theme) {
  const entry = states[name];
  if (!entry) return '';
  return theme === 'dark' ? (entry.darkEdgeStyle || entry.edgeStyle) : entry.edgeStyle;
}

/**
 * Resolves the style string for a state under a theme.
 * @param {object} states - Normalized vocabulary
 * @param {string} name
 * @param {string} theme - 'light' | 'dark'
 */
export function styleFor(states, name, theme) {
  const entry = states[name];
  if (!entry) return '';
  return theme === 'dark' ? (entry.darkStyle || entry.style) : entry.style;
}

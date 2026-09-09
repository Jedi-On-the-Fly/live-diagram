/**
 * The library's own stylesheet, injected once per document.
 *
 * Everything is namespaced under `.ld` and defined with CSS custom properties,
 * so overriding it is a variable, not a `!important`.
 */

export const CSS = `
.ld { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%;
      background: var(--ld-bg, transparent);
      --ld-badge-bg: #0f172a; --ld-badge-fg: #f8fafc; --ld-focus: #6366f1;
      --ld-control-bg: rgba(255,255,255,.9); --ld-control-fg: #0f172a; --ld-control-border: #cbd5e1; }
.ld[data-theme="dark"] { --ld-badge-bg: #e2e8f0; --ld-badge-fg: #0f172a;
      --ld-control-bg: rgba(15,23,42,.9); --ld-control-fg: #e2e8f0; --ld-control-border: #334155; }
.ld[data-chrome="none"] { display: block; height: auto; }
.ld-viewport { position: relative; flex: 1; min-height: 0; overflow: auto; cursor: grab;
  display: grid; place-items: safe center;
  /* Room for badge chips, which sit half outside the node's bounding box and
     would otherwise be clipped against the top edge. */
  padding: 12px; }
.ld-viewport.is-panning { cursor: grabbing; user-select: none; }
.ld-canvas { display: inline-block; }
.ld-canvas svg { display: block; max-width: none !important; height: auto; }
.ld-overlay { position: absolute; inset: 0; pointer-events: none; }
.ld-badge { position: absolute; transform: translate(-50%, -50%); pointer-events: none;
  background: var(--ld-badge-bg); color: var(--ld-badge-fg); border-radius: 999px;
  font: 600 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 2px 7px;
  white-space: nowrap; box-shadow: 0 1px 3px rgba(0,0,0,.25); }
/* A diagram whose source has gone away says so, rather than showing an old
   run as if it were current. Override --ld-stale-opacity to taste. */
.ld[data-ld-connection="stale"] .ld-canvas,
.ld[data-ld-connection="stale"] .ld-overlay { opacity: var(--ld-stale-opacity, .55); filter: saturate(.65); }
.ld[data-ld-connection="stale"]::after {
  content: attr(data-ld-stale-label); position: absolute; top: 8px; left: 50%;
  transform: translateX(-50%); z-index: 3; pointer-events: none;
  background: var(--ld-badge-bg); color: var(--ld-badge-fg); border-radius: 999px;
  font: 600 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 3px 10px;
}
.ld-overlay-item { position: absolute; transform: translate(-50%, -50%); }
.ld-node { cursor: pointer; }
.ld-edge { transition: stroke .18s ease; }
.ld-edge[data-ld-edge-state="running"] { stroke-dasharray: 6 5; animation: ld-flow .9s linear infinite; }
@keyframes ld-flow { to { stroke-dashoffset: -22; } }
@media (prefers-reduced-motion: reduce) { .ld-edge { animation: none !important; } }
.ld-node:focus { outline: none; }
.ld-node:focus-visible > :first-child { outline: 2px solid var(--ld-focus); outline-offset: 3px; }
.ld-node:hover { filter: brightness(1.06); }
.ld-controls { position: absolute; right: 10px; bottom: 10px; display: flex; gap: 4px; z-index: 2; }
.ld-controls button { width: 28px; height: 28px; border-radius: 6px; cursor: pointer;
  background: var(--ld-control-bg); color: var(--ld-control-fg);
  border: 1px solid var(--ld-control-border); font: 600 13px/1 system-ui, sans-serif; }
.ld-controls button:hover { filter: brightness(1.1); }
@media (prefers-reduced-motion: no-preference) {
  .ld-node > :first-child { transition: fill .18s ease, stroke .18s ease; }
}

/* ── kit ─────────────────────────────────────────────────────────────────── */
.ld-legend, .ld-inspector, .ld-transport {
  font: 13px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--ld-kit-fg, inherit);
}
.ld-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; }
.ld-legend__item { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; }
.ld-legend__swatch { width: 11px; height: 11px; border-radius: 3px; border: 1.5px solid; display: inline-block; }
.ld-legend__item b { font-variant-numeric: tabular-nums; opacity: .65; font-weight: 600; }

.ld-inspector { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; margin: 0; align-items: baseline; }
/* The display:grid above beats the browser's own [hidden] rule, so a hidden
   tooltip would sit visible and empty in a corner. It did. */
.ld-inspector[hidden] { display: none !important; }
.ld-inspector dt { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; opacity: .6; }
.ld-inspector dd { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; overflow-wrap: anywhere; }
.ld-inspector--tooltip {
  position: absolute; z-index: 3; pointer-events: none; max-width: 280px;
  padding: 8px 10px; border-radius: 8px;
  background: var(--ld-badge-bg); color: var(--ld-badge-fg);
  box-shadow: 0 2px 10px rgba(0,0,0,.28);
}
.ld-inspector--tooltip dt { opacity: .7; }

.ld-transport { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ld-transport__button {
  min-width: 30px; height: 28px; border-radius: 7px; cursor: pointer;
  background: var(--ld-control-bg); color: var(--ld-control-fg);
  border: 1px solid var(--ld-control-border); font-size: 13px; line-height: 1;
}
.ld-transport__button:hover { filter: brightness(1.1); }
.ld-transport__scrub { flex: 1; min-width: 110px; }
.ld-transport__clock { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; opacity: .7; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ld-transport__speed {
  height: 28px; border-radius: 7px; font-size: 12px; padding: 0 4px;
  background: var(--ld-control-bg); color: var(--ld-control-fg); border: 1px solid var(--ld-control-border);
}
`;

const STYLE_MARK = 'data-live-diagram-styles';

/** Injects the stylesheet once per document. */
export function ensureStyles(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || d.querySelector(`style[${STYLE_MARK}]`)) return;
  const style = d.createElement('style');
  style.setAttribute(STYLE_MARK, '');
  style.textContent = CSS;
  d.head.appendChild(style);
}

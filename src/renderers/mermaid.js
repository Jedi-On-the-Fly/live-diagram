/**
 * The Mermaid renderer adapter.
 *
 * Mermaid is a peer, not a dependency, and it is reachable only from this
 * file. The core knows nothing about it — which is the point: the state model,
 * the timeline, the viewport and the event routing survive a renderer swap.
 */

import { buildDefinition } from './mermaid-def.js';

// A shared id would make Mermaid tear the OTHER container's SVG out of the
// document — two diagrams on one page, or a dashboard plus an editor preview,
// and one of them silently vanishes. Learned the hard way; never share the id.
let renderSeq = 0;

/** Resolves 'auto' against the document, so a page-level theme just works. */
export function resolveTheme(preference) {
  if (preference === 'dark' || preference === 'light') return preference;
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark' || attr === 'light') return attr;
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    try {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    } catch (_) { /* jsdom and friends */ }
  }
  return 'light';
}

/**
 * Maps rendered SVG groups back to node ids and tags them with
 * `data-ld-node`. Everything downstream — click delegation, badges, focus
 * rings, your own CSS — hangs off that one attribute rather than off
 * Mermaid's internal id scheme, which has changed between majors before.
 *
 * @param {Element} container
 * @param {Array<string>} ids
 * @param {object} graph
 * @returns {Map<string, Element>}
 */
export function tagNodes(container, ids, graph) {
  const map = new Map();
  const known = new Set(ids);
  const elements = Array.from(container.querySelectorAll('g.node'));

  for (const el of elements) {
    const raw = el.id || '';
    // Mermaid v10/v11 emit ids like `flowchart-build-12`.
    const stripped = raw.replace(/^(?:flowchart|graph|statediagram)-/, '').replace(/-\d+$/, '');
    const candidate = known.has(stripped) ? stripped : (known.has(raw) ? raw : null);
    if (candidate && !map.has(candidate)) map.set(candidate, el);
  }

  // Fallback: match on the rendered label. Only reached if Mermaid changes its
  // id scheme again, but it keeps clicks working when it does.
  if (map.size < known.size && graph) {
    for (const id of known) {
      if (map.has(id)) continue;
      const label = String(graph.nodes[id] && graph.nodes[id].label || '').trim();
      if (!label) continue;
      const hit = elements.find((el) => !Array.from(map.values()).includes(el)
        && (el.textContent || '').trim().replace(/^\S+\s/, '') === label.replace(/^\S+\s/, ''));
      if (hit) map.set(id, hit);
    }
  }

  for (const [id, el] of map) {
    el.setAttribute('data-ld-node', id);
    el.classList.add('ld-node');
  }
  return map;
}

/**
 * Maps rendered edge paths back to edge ids and tags them `data-ld-edge`.
 *
 * Mermaid names an edge path `L_<from>_<to>_<index>`, which is ambiguous to
 * split when node ids contain underscores — but the trailing index is the
 * edge's position in the definition, and that order is ours. Document order
 * inside `.edgePaths` is the fallback.
 *
 * @param {Element} container
 * @param {object} graph - Normalized graph
 * @returns {Map<string, Element>}
 */
export function tagEdges(container, graph) {
  const map = new Map();
  const paths = Array.from(container.querySelectorAll('.edgePaths > path, path.flowchart-link'));
  const edges = graph.edges || [];

  paths.forEach((path, position) => {
    const fromId = /_(\d+)$/.exec(path.id || '');
    const index = fromId ? Number(fromId[1]) : position;
    const edge = edges[index];
    if (!edge || map.has(edge.id)) return;
    map.set(edge.id, path);
    path.setAttribute('data-ld-edge', edge.id);
    path.classList.add('ld-edge');
  });
  return map;
}

/**
 * Creates a Mermaid renderer.
 *
 * @param {object} [options]
 * @param {object} [options.mermaid] - Mermaid module (defaults to globalThis.mermaid)
 * @param {object} [options.config] - Extra config passed to mermaid.initialize
 * @param {boolean} [options.showIcons=false] - Prefix node labels with state icons
 * @param {object} [options.flowchart] - Shorthand for config.flowchart
 * @param {boolean} [options.svgLabels=false] - Draw labels as SVG text instead of HTML.
 *   Required for PNG export, and a Mermaid trap in its own right: the setting has
 *   to be given at BOTH the top level and under `flowchart`, or it is ignored.
 */
export function mermaidRenderer(options) {
  const opts = options || {};
  let initializedTheme = null;

  const lib = () => {
    const m = opts.mermaid || (typeof globalThis !== 'undefined' ? globalThis.mermaid : null);
    if (!m || typeof m.render !== 'function') {
      throw new Error('mermaidRenderer: Mermaid is not available. Load mermaid before LiveDiagram, or pass it as mermaidRenderer({ mermaid }).');
    }
    return m;
  };

  return {
    name: 'mermaid',

    /** Builds the definition without touching the DOM — useful for export and tests. */
    definition(args) {
      return buildDefinition({
        graph: args.graph,
        snapshot: args.snapshot,
        states: args.states,
        options: { showIcons: opts.showIcons === true, theme: resolveTheme(args.theme), defaultState: args.defaultState }
      });
    },

    /**
     * @returns {Promise<{svg: string, nodes: Map<string, Element>, definition: string}>}
     */
    async render(args) {
      const mermaid = lib();
      const theme = resolveTheme(args.theme);
      if (initializedTheme !== theme) {
        const config = {
          startOnLoad: false,
          // `click` directives are not used — clicks are delegated from the
          // container — but loose keeps user-supplied labels rendering as
          // written rather than being re-encoded.
          securityLevel: 'loose',
          theme: theme === 'dark' ? 'dark' : 'default',
          ...(opts.config || {}),
          ...(opts.flowchart ? { flowchart: opts.flowchart } : {})
        };
        if (opts.svgLabels) {
          config.htmlLabels = false;
          config.flowchart = { ...(config.flowchart || {}), htmlLabels: false };
        }
        mermaid.initialize(config);
        initializedTheme = theme;
      }

      const definition = this.definition({ ...args, theme });
      const renderId = `ld-${(renderSeq++).toString(36)}`;
      const result = await mermaid.render(renderId, definition);
      const svg = typeof result === 'string' ? result : result.svg;

      args.container.innerHTML = svg;
      // Mermaid emits width="100%", which a shrink-wrapped inline-block
      // resolves to the CSS replaced-element default of 300px. Pin the box to
      // the drawing's own size; the viewport rescales this width to zoom.
      const rootSvg = args.container.querySelector('svg');
      if (rootSvg && rootSvg.viewBox && rootSvg.viewBox.baseVal && rootSvg.viewBox.baseVal.width) {
        rootSvg.style.width = `${rootSvg.viewBox.baseVal.width}px`;
      }
      if (result && typeof result.bindFunctions === 'function') {
        try { result.bindFunctions(args.container); } catch (_) { /* no click directives to bind */ }
      }

      const nodes = tagNodes(args.container, Object.keys(args.graph.nodes), args.graph);
      const edges = tagEdges(args.container, args.graph);
      return { svg, nodes, edges, definition };
    },

    destroy() { initializedTheme = null; }
  };
}

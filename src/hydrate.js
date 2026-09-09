/**
 * Hydration — turning static blocks in a rendered page into live diagrams.
 *
 * Documentation sites are where Mermaid users already are, and every one of
 * them has a different plugin system. Rather than write four plugins, this
 * scans the *rendered output* those systems all produce and mounts diagrams in
 * place. A docs author writes a fenced block; a site owner adds two script
 * tags. Nobody writes a plugin.
 *
 * Three sources are recognised:
 *
 *   <script type="application/live-diagram+json">{ … }</script>
 *   ```live-diagram  →  <pre><code class="language-live-diagram">{ … }</code></pre>
 *   <div data-live-diagram='{ … }'></div>
 *
 * The payload is a spec — `{graph, states, initial, events, …}` — or, for the
 * common case, a bare graph (`{nodes, edges}`), detected by its own shape.
 */

import { LiveDiagram } from './live-diagram.js';
import { looksLikeMermaid } from './parse-mermaid.js';

const HYDRATED = 'data-ld-hydrated';

/**
 * Pulls the spec out of a block.
 *
 * A block may hold JSON *or* plain Mermaid source, because the people writing
 * these blocks already have Mermaid diagrams and should not have to translate
 * one into JSON to make it live.
 */
function readSpec(text, where) {
  const trimmed = String(text).trim();
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    if (looksLikeMermaid(trimmed)) return { graph: trimmed };
    throw new Error(`live-diagram: ${where} contains neither valid JSON nor Mermaid source — ${err.message}`);
  }
}

function normalizeSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('live-diagram: empty spec');
  // A bare graph is the shape people write first; accept it.
  return spec.graph || spec.nodes ? (spec.graph ? spec : { graph: spec }) : spec;
}

/**
 * The element a highlighter wrapped the block in — hiding only the <code>
 * would leave an empty box behind on half these sites.
 */
function outermostBlock(el) {
  let block = el.matches('pre, div') ? el : el.closest('pre') || el;
  const parent = block.parentElement;
  if (parent && /highlight|language-|code-?block/i.test(parent.className || '') && parent.children.length === 1) {
    block = parent;
  }
  return block;
}

/**
 * Mounts one spec into a container.
 * @returns {LiveDiagram}
 */
export function mountSpec(spec, container, defaults) {
  const config = normalizeSpec(spec);
  const options = defaults || {};
  if (config.height) container.style.height = config.height;
  else if (!container.style.height) container.style.height = options.height || '420px';

  const diagram = new LiveDiagram({
    mount: container,
    graph: config.graph,
    states: config.states,
    initial: config.initial,
    theme: config.theme || options.theme || 'auto',
    defaultState: config.defaultState,
    controls: config.controls !== undefined ? config.controls : options.controls !== false,
    showIcons: config.showIcons === true,
    autoFit: config.autoFit !== false
  });

  if (Array.isArray(config.events) && config.events.length) {
    const timeline = diagram.timeline(config.events);
    diagram.replay = timeline;
    // A diagram in documentation should say something the moment it is seen:
    // either it plays, or it shows the end state of what it recorded.
    if (config.autoplay) timeline.play({ speed: config.speed || 1, loop: config.loop !== false });
    else timeline.seek(timeline.duration);
  }
  return diagram;
}

/**
 * Finds every hydratable block under `root` and mounts it.
 *
 * @param {Element|Document} [root=document]
 * @param {object} [options] - Defaults: {height, theme, controls, fence}
 * @returns {Array<LiveDiagram>}
 */
export function hydrate(root, options) {
  const scope = root || (typeof document !== 'undefined' ? document : null);
  if (!scope) return [];
  const opts = options || {};
  const fence = opts.fence || 'live-diagram';
  const doc = scope.ownerDocument || scope;
  const mounted = [];

  // Every static-site generator marks a fenced block differently: Docusaurus
  // puts `language-x` on the <pre>, VitePress on a wrapping <div>, Jekyll on an
  // outer div, Hugo uses data-lang, markdown-it puts it on the <code>. Matching
  // the class wherever it lands covers all of them; the script-block form below
  // covers the ones that strip it entirely.
  const seen = new Set();
  const targets = [];
  const collect = (selector) => {
    for (const el of scope.querySelectorAll(selector)) {
      if (!seen.has(el)) { seen.add(el); targets.push(el); }
    }
  };
  collect(`script[type="application/live-diagram+json"]:not([${HYDRATED}])`);
  collect(`.language-${fence}:not([${HYDRATED}]), [data-lang="${fence}"]:not([${HYDRATED}])`);
  collect(`[data-live-diagram]:not([${HYDRATED}])`);

  for (const source of targets) {
    // Mermaid must be present before anything is replaced — otherwise a missing
    // <script> tag silently eats the reader's content.
    if (!globalThis.mermaid) {
      console.error('live-diagram: Mermaid is not loaded, leaving the source block in place.');
      return mounted;
    }
    // Marked before parsing, not after: a block with a broken spec must be
    // complained about once, not on every hydrate() call.
    source.setAttribute(HYDRATED, '');

    try {
      let spec;
      let container;

      if (source.tagName === 'SCRIPT') {
        spec = readSpec(source.textContent, 'a live-diagram script block');
        container = doc.createElement('div');
        source.parentNode.insertBefore(container, source.nextSibling);
      } else if (source.hasAttribute('data-live-diagram')) {
        spec = readSpec(source.getAttribute('data-live-diagram'), 'a data-live-diagram attribute');
        container = source;
      } else {
        // A fenced block, wherever the language class landed. The text is read
        // from the <code>, so a syntax highlighter's <span> soup is harmless.
        const code = source.matches('code') ? source : source.querySelector('code') || source;
        spec = readSpec(code.textContent, `a \`\`\`${fence} block`);
        container = doc.createElement('div');
        const block = outermostBlock(source);
        block.parentNode.insertBefore(container, block);
        block.setAttribute(HYDRATED, '');
        block.style.display = 'none';   // hidden, not removed: view-source still shows the spec
      }

      container.classList.add('ld-hydrated');
      mounted.push(mountSpec(spec, container, opts));
    } catch (err) {
      console.error(err.message || err);
      // The block stays visible and readable — a broken spec must not blank a
      // paragraph of someone's documentation.
    }
  }
  return mounted;
}

/**
 * Wires `<script src="…/live-diagram.umd.js" data-auto>` to hydrate on load.
 * The two-tag docs-site install, and the reason this file exists.
 *
 * @param {?Element} script - The script element that loaded the library
 */
export function autoHydrate(script) {
  if (!script || !script.hasAttribute || !script.hasAttribute('data-auto')) return false;
  const options = {
    fence: script.getAttribute('data-fence') || undefined,
    theme: script.getAttribute('data-theme') || undefined,
    height: script.getAttribute('data-height') || undefined,
    controls: script.getAttribute('data-controls') !== 'false'
  };
  const run = () => hydrate(document, options);
  if (typeof document === 'undefined') return false;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
  return true;
}

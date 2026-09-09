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
/**
 * Mounts one spec into a container.
 * @returns {LiveDiagram}
 */
export declare function mountSpec(spec: any, container: any, defaults: any): LiveDiagram;
/**
 * Finds every hydratable block under `root` and mounts it.
 *
 * @param {Element|Document} [root=document]
 * @param {object} [options] - Defaults: {height, theme, controls, fence}
 * @returns {Array<LiveDiagram>}
 */
export declare function hydrate(root?: Element | Document, options?: object): Array<LiveDiagram>;
/**
 * Wires `<script src="…/live-diagram.umd.js" data-auto>` to hydrate on load.
 * The two-tag docs-site install, and the reason this file exists.
 *
 * @param {?Element} script - The script element that loaded the library
 */
export declare function autoHydrate(script: Element | null): boolean;

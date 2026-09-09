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
/**
 * Parses an attribute that may be inline JSON, a `#selector` pointing at a
 * script tag, or — for `graph` — plain Mermaid source.
 */
export declare function readJsonAttr(el: any, name: any, allowMermaid: any): any;
/**
 * Defines the element. Called automatically by the UMD build (the drop-in-a-page
 * path); ESM users call it themselves so importing the library stays free of
 * side effects.
 *
 * @param {string} [tagName='live-diagram']
 * @param {object} [globalScope] - Where to find customElements (tests pass a stub)
 * @returns {?Function} The element class, or null if it was already defined.
 */
export declare function defineLiveDiagram(tagName?: string, globalScope?: object): Function | null;

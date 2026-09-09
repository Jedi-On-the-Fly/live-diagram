/**
 * The Mermaid renderer adapter.
 *
 * Mermaid is a peer, not a dependency, and it is reachable only from this
 * file. The core knows nothing about it — which is the point: the state model,
 * the timeline, the viewport and the event routing survive a renderer swap.
 */
/** Resolves 'auto' against the document, so a page-level theme just works. */
export declare function resolveTheme(preference: any): any;
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
export declare function tagNodes(container: Element, ids: Array<string>, graph: object): Map<string, Element>;
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
export declare function tagEdges(container: Element, graph: object): Map<string, Element>;
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
export declare function mermaidRenderer(options?: {
    mermaid?: object;
    config?: object;
    showIcons?: boolean;
    flowchart?: object;
    svgLabels?: boolean;
}): {
    name: string;
    /** Builds the definition without touching the DOM — useful for export and tests. */
    definition(args: any): string;
    /**
     * @returns {Promise<{svg: string, nodes: Map<string, Element>, definition: string}>}
     */
    render(args: any): Promise<{
        svg: string;
        nodes: Map<string, Element>;
        definition: string;
    }>;
    destroy(): void;
};

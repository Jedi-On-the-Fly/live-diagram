/**
 * Mermaid flowchart source → a graph spec.
 *
 * The library's own format is JSON, which is right for a program and wrong for
 * a person: anyone who would want a live diagram already has a Mermaid one,
 * written by hand, sitting in a README. Asking them to translate it first is a
 * tax paid before they have seen the thing work.
 *
 * This parses the flowchart subset — nodes, shapes, every edge form, chains,
 * `&` groups and subgraphs — and refuses everything else with a message that
 * says what it got. It is not a Mermaid implementation and does not try to be:
 * layout, styling directives and the other twelve diagram types stay Mermaid's
 * job.
 */
/**
 * Parses Mermaid flowchart source.
 *
 * @param {string} source
 * @param {object} [options]
 * @param {boolean} [options.strict=false] - Throw on directives it ignores
 * @returns {object} A graph spec: {direction, nodes, edges, groups}
 */
export declare function parseMermaid(source: string, options?: {
    strict?: boolean;
}): object;
/** @returns {boolean} Whether a string looks like Mermaid source rather than JSON. */
export declare function looksLikeMermaid(text: any): boolean;

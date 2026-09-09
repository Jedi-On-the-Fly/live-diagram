/**
 * graph + state -> a Mermaid flowchart definition. A pure function, which is
 * why it can be unit-tested in Node with no browser, no DOM and no Mermaid
 * installed. Everything that could be pure here is.
 */
/**
 * Mermaid's default cluster fill is a pale yellow that fights every palette it
 * is put next to. Groups are structure, not status, so they get a neutral box
 * unless the caller says otherwise.
 */
declare const GROUP_STYLE: {
    light: string;
    dark: string;
};
/**
 * @param {string} shape
 * @param {string} id
 * @param {string} label - Already escaped
 */
export declare function nodeSyntax(shape: string, id: string, label: string): any;
/**
 * Builds a complete flowchart definition.
 *
 * @param {object} args
 * @param {object} args.graph - Normalized graph
 * @param {object} args.snapshot - {states, badges, data}
 * @param {object} args.states - Normalized state vocabulary
 * @param {object} [args.options]
 * @param {boolean} [args.options.showIcons=false] - Prefix labels with the state icon
 * @param {string} [args.options.theme='light']
 * @param {string} [args.options.defaultState='idle']
 * @param {string} [args.options.groupStyle] - Style line for subgraph boxes
 * @returns {string}
 */
export declare function buildDefinition(args: {
    graph: object;
    snapshot: object;
    states: object;
    options?: {
        showIcons?: boolean;
        theme?: string;
        defaultState?: string;
        groupStyle?: string;
    };
}): string;
export { GROUP_STYLE };

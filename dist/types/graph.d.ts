/**
 * The graph model: plain data in, validated plain data out.
 *
 * Structure and state are kept apart on purpose. A graph describes what the
 * boxes ARE; it never says how they are doing. That separation is what makes
 * replay, diffing and live streaming fall out of the same code path — the
 * state channel is the only thing that moves.
 */
export type GraphNode = {
    /**
     * - Displayed text (defaults to the node id)
     */
    label?: string;
    shape?: 'rect' | 'rounded' | 'stadium' | 'diamond' | 'circle' | 'hex' | 'subroutine' | 'cylinder';
    /**
     * - Rendered as the node's title attribute
     */
    description?: string;
    /**
     * - A Mermaid classDef name
     */
    class?: string;
    /**
     * - Anything of your own; carried through untouched
     */
    meta?: object;
};
export type GraphEdge = {
    from: string;
    to: string;
    /**
     * - Defaults to `from->to`; needed only for parallel edges
     */
    id?: string;
    label?: string;
    /**
     * - Anything but 'always' draws a dotted edge
     */
    condition?: string;
    style?: string;
};
export type GraphGroup = {
    id: string;
    label?: string;
    nodes: Array<string>;
};
export type GraphSpec = {
    direction?: 'TB' | 'TD' | 'BT' | 'LR' | 'RL';
    nodes: Record<string, string | GraphNode>;
    edges?: Array<GraphEdge>;
    groups?: Array<GraphGroup>;
};
declare const DIRECTIONS: string[];
declare const SHAPES: string[];
/** @returns {boolean} Whether an id is safe to emit into a diagram definition. */
export declare function isValidId(id: any): boolean;
/**
 * Escapes a label for use inside a quoted Mermaid string.
 * @param {string} label
 */
export declare function escapeLabel(label: string): string;
/**
 * Normalizes and validates a graph definition.
 *
 * Mermaid source is accepted directly: anyone who wants a live diagram already
 * has one written by hand, and asking them to translate it into JSON first is a
 * tax paid before they have seen anything work.
 *
 * @param {GraphSpec|string} graph - A graph spec, or Mermaid flowchart source
 * @returns {object} A frozen, normalized graph.
 */
export declare function normalizeGraph(graph: GraphSpec | string): object;
/** @returns {Array<string>} Node ids in declaration order. */
export declare function nodeIds(graph: any): Array<string>;
/** @returns {Array<string>} Edge ids in declaration order. */
export declare function edgeIds(graph: any): Array<string>;
export { DIRECTIONS, SHAPES };

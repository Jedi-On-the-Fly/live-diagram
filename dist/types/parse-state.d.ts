/**
 * Mermaid state diagram source → a graph spec.
 *
 * A state diagram is the one Mermaid diagram type whose whole subject is the
 * thing this library animates. Refusing it would have been a strange gap: the
 * shapes differ, the semantics do not.
 *
 * Supported: transitions with labels, `[*]` start and stop markers (per scope),
 * `state "Label" as id`, `id : description`, composite states as groups, and
 * the `<<choice>>` / `<<fork>>` / `<<join>>` markers. Notes are read and
 * discarded — they are annotation, not structure.
 */
/**
 * @param {string} source
 * @param {object} [options]
 * @param {boolean} [options.strict=false]
 * @returns {object} A graph spec: {direction, nodes, edges, groups}
 */
export declare function parseStateDiagram(source: string, options?: {
    strict?: boolean;
}): object;

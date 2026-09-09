/**
 * Pieces both Mermaid parsers need.
 *
 * They live here rather than in one parser importing the other, because the
 * flowchart parser dispatches to the state parser and the bundle allows no
 * cycles — a rule that costs one small file and buys a build that cannot fail
 * at load time.
 */
export declare const SAFE_ID: RegExp;
/**
 * Rewrites source ids into ids this library can emit, remembering the mapping
 * so both ends of every edge follow the same rewrite.
 * @returns {function(string): string}
 */
export declare function makeIdMapper(): Function;
/** Strips `%%` comments and `%%{init}%%` directives without touching quoted text. */
export declare function stripComments(source: any): any;

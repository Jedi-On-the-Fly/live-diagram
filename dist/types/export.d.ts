/**
 * Getting a diagram back out: as a file, or as a link.
 *
 * A diagram that only exists in a browser tab is half a tool. People put these
 * in incident reports, in slide decks, and in messages to colleagues — and
 * "screenshot it" loses the crispness, the badges and the state at the same
 * time.
 *
 * Two honest limitations, both stated rather than papered over: badges and
 * overlays are HTML, so an SVG export redraws badges in SVG and cannot carry
 * arbitrary overlay content; and PNG rasterisation cannot render Mermaid's
 * default HTML labels (see `toPNG`).
 */
/**
 * The diagram as a standalone SVG string.
 *
 * @param {object} diagram - A LiveDiagram
 * @param {object} [options]
 * @param {string} [options.background] - A colour behind the diagram (default: transparent)
 * @param {boolean} [options.badges=true] - Redraw badge chips into the SVG
 * @returns {string}
 */
export declare function toSVG(diagram: object, options?: {
    background?: string;
    badges?: boolean;
}): string;
/**
 * The diagram as a PNG blob.
 *
 * Mermaid renders node labels as HTML inside `<foreignObject>` by default, and
 * no browser rasterises foreignObject when an SVG is drawn to a canvas — the
 * labels would silently vanish. Rather than ship an export that quietly loses
 * every word, this refuses and says how to fix it.
 *
 * @param {object} diagram
 * @param {object} [options]
 * @param {number} [options.scale=2]
 * @param {string} [options.background='#ffffff']
 * @returns {Promise<Blob>}
 */
export declare function toPNG(diagram: object, options?: {
    scale?: number;
    background?: string;
}): Promise<Blob>;
/**
 * Saves the diagram as a file.
 *
 * A page inside a sandboxed viewer (a Claude artifact, some embeds) blocks
 * downloads it did not initiate; there the honest move is to hand the caller
 * `toSVG()` and let them copy it.
 *
 * @param {object} diagram
 * @param {object} [options] - {format: 'svg'|'png', filename, ...toSVG/toPNG options}
 * @returns {Promise<void>}
 */
export declare function download(diagram: object, options?: object): Promise<void>;
/**
 * Encodes anything JSON-able into a URL-safe string.
 * @param {object} payload
 * @returns {string}
 */
export declare function encodeState(payload: object): string;
/**
 * The inverse. Returns null for anything it cannot read, because a mangled
 * link should land on the default view rather than on an error.
 * @param {string} text
 * @returns {?object}
 */
export declare function decodeState(text: string): object | null;
/**
 * "Send someone this exact diagram, in this exact state."
 *
 * @param {object} diagram
 * @param {object} [options]
 * @param {string|object} [options.graph] - Prefer the Mermaid source you started from; it is
 *   far shorter than the expanded graph and is what a human would want to read
 * @param {string} [options.url] - Base URL (defaults to the current location)
 * @returns {string}
 */
export declare function shareUrl(diagram: object, options?: {
    graph?: string | object;
    url?: string;
}): string;
/**
 * Reads a payload written by `shareUrl` and applies it.
 * @param {object} diagram
 * @param {string} [hash] - Defaults to the current location hash
 * @returns {boolean} Whether anything was applied
 */
export declare function applyShared(diagram: object, hash?: string): boolean;

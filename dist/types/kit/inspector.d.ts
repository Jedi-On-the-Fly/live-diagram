/**
 * An inspector: what the thing under the pointer, or the thing you just
 * clicked, actually is.
 *
 * Four demos, four hand-written detail panels — all showing the same five
 * fields the payload already carries. This is that panel, with the template
 * exposed so it can be replaced rather than fought.
 */
/** The default template: a definition list of what is known. */
export declare function defaultTemplate(payload: any): string;
/**
 * @param {object} diagram - A LiveDiagram
 * @param {object} [options]
 * @param {'panel'|'tooltip'} [options.mode='panel']
 * @param {Element|string} [options.mount] - Required for 'panel'; ignored for 'tooltip'
 * @param {function(object): string} [options.template] - Return HTML for a payload
 * @param {string} [options.empty='Click a node.'] - Panel text with nothing selected
 * @param {boolean} [options.edges=true] - Also inspect edges
 * @returns {{el: Element, show: function, destroy: function}}
 */
export declare function inspector(diagram: object, options?: {
    mode?: 'panel' | 'tooltip';
    mount?: Element | string;
}): {
    el: Element;
    show: Function;
    destroy: Function;
};

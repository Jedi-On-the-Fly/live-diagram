/**
 * A legend, built from the state vocabulary the diagram already holds.
 *
 * Every demo written against this library hand-rolled one of these, which is
 * the clearest possible signal that it belongs here. It is opt-in: the core
 * renders diagrams, and none of the kit is loaded into a page that never calls
 * it.
 */
/**
 * @param {object} diagram - A LiveDiagram
 * @param {object} [options]
 * @param {Element|string} [options.mount] - Where to put it (else use `.el` yourself)
 * @param {boolean} [options.counts=true] - Show how many nodes are in each state
 * @param {boolean} [options.hideUnused=false] - Only show states in use
 * @param {Array<string>} [options.only] - Restrict to these state names, in this order
 * @returns {{el: Element, update: function, destroy: function}}
 */
export declare function legend(diagram: object, options?: {
    mount?: Element | string;
    counts?: boolean;
    hideUnused?: boolean;
    only?: Array<string>;
}): {
    el: Element;
    update: Function;
    destroy: Function;
};

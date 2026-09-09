/**
 * Play, pause, step, scrub.
 *
 * `Timeline` is the interesting half and it is in the core; this is the row of
 * buttons everybody writes afterwards, wired to it correctly — including the
 * two details that are easy to get wrong: scrubbing pauses playback, and the
 * clock follows the timeline rather than a second timer of its own.
 */
/**
 * @param {object} diagram - A LiveDiagram (the source of `tick`)
 * @param {object} timeline - The Timeline returned by diagram.timeline()
 * @param {object} [options]
 * @param {Element|string} [options.mount]
 * @param {number} [options.speed=1]
 * @param {boolean} [options.loop=false]
 * @param {Array<number>} [options.speeds=[1, 2, 5, 12]] - Empty array hides the selector
 * @returns {{el: Element, destroy: function}}
 */
export declare function transport(diagram: object, timeline: object, options?: {
    mount?: Element | string;
    speed?: number;
    loop?: boolean;
    speeds?: Array<number>;
}): {
    el: Element;
    destroy: Function;
};

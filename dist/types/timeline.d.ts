/**
 * The timeline — the piece nothing else in this space has.
 *
 * Because state only ever arrives as an ordered stream of patches, the exact
 * component that renders "now" can render any earlier moment: fold the events
 * up to time t and you have the diagram as it stood. Replay, scrubbing and
 * "what did this look like when it broke" are the same three lines of code.
 *
 * Folding from the start on every seek is O(n) per seek. For a run of a few
 * thousand events that is microseconds, and it keeps seeking backwards exactly
 * as correct as seeking forwards — which a running incremental cursor is not.
 * Forward seeks do reuse the cursor; backward seeks refold.
 */
/**
 * Normalizes a raw event list.
 *
 * Accepted event shapes:
 *   { t, node, state, badge?, data? }
 *   { t, patch: { nodeId: 'state' | {...} } }
 *
 * `t` may be an absolute timestamp (epoch ms) or already relative; the
 * timeline rebases to 0 either way and keeps the original as `at`.
 *
 * @param {Array<object>} events
 * @returns {{events: Array<object>, t0: number, duration: number}}
 */
export declare function normalizeEvents(events: Array<object>): {
    events: Array<object>;
    t0: number;
    duration: number;
};
export declare class Timeline {
    events: object[];
    t0: number;
    duration: number;
    _handlers: object;
    _cursor: number;
    _position: number;
    _timer: number;
    _speed: number;
    /**
     * @param {Array<object>} events
     * @param {object} handlers
     * @param {function(object, object): void} handlers.apply - apply(patch, {index, t, reset})
     * @param {function(): void} [handlers.onReset] - Called before a backwards fold
     * @param {function(object): void} [handlers.onTick] - Called after each seek/step
     * @param {function(): void} [handlers.onEnd]
     */
    constructor(events: Array<object>, handlers: object);
    get length(): number;
    get position(): number;
    get index(): number;
    get playing(): boolean;
    /**
     * Moves to time `t` (ms from the start of the timeline) and applies
     * everything up to it.
     * @param {number} t
     */
    seek(t: number): this;
    /**
     * Applies exactly ONE event and moves the position onto it.
     *
     * Deliberately not `seek(next.t)`: several events can share a timestamp, and
     * a "next" button that sometimes advances by three is a confusing button.
     * @returns {boolean} False when there is nothing left.
     */
    step(): boolean;
    /** Rewinds to the beginning (an empty diagram). */
    reset(): this;
    /**
     * Plays from the current position.
     * @param {object} [options]
     * @param {number} [options.speed=1] - Wall-clock multiplier
     * @param {number} [options.fps=30]
     * @param {boolean} [options.loop=false]
     */
    play(options?: {
        speed?: number;
        fps?: number;
        loop?: boolean;
    }): this;
    /** Stops playback, keeping the position. */
    pause(): this;
    /** Stops playback and rewinds. */
    stop(): this;
    /** Releases the timer. */
    destroy(): void;
}

/**
 * A ~30-line event emitter. Deliberately not an npm dependency: the whole
 * library is meant to drop into a page with no build step, and one more
 * transitive package is one more reason not to.
 */
export declare class Emitter {
    _handlers: Map<any, any>;
    constructor();
    /**
     * Subscribes to an event.
     * @param {string} event
     * @param {function} handler
     * @returns {function(): void} Unsubscribe function.
     */
    on(event: string, handler: Function): Function;
    /** Subscribes for exactly one delivery. */
    once(event: any, handler: any): Function;
    /** Unsubscribes a handler (or every handler for the event). */
    off(event: any, handler: any): void;
    /**
     * Emits an event. A throwing handler never breaks the emit loop or the
     * render that triggered it — it is reported on the `error` channel instead.
     */
    emit(event: any, payload: any): number;
    /** Drops every subscription. */
    clear(): void;
}

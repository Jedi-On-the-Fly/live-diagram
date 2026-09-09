/**
 * State sources.
 *
 * A source is anything with `start(emit)` and `stop()`. That is the entire
 * interface, and it is small on purpose: the library must not care whether
 * your state arrives over a socket, an SSE stream, a poll, or a function you
 * call by hand. Three adapters ship because they cover most of it; a fourth is
 * fifteen lines of your own code.
 */
/**
 * @param {string} url
 * @param {object} [options]
 * @param {function(any): ?object} [options.parse] - message -> patch (return null to ignore)
 * @param {Array<string>} [options.protocols]
 * @param {number} [options.retryMs=2000] - 0 disables reconnection
 */
export declare function webSocketSource(url: string, options?: object): {
    name: string;
    start(emit: any, notify: any): void;
    stop(): void;
};
/**
 * Server-Sent Events.
 * @param {string} url
 * @param {object} [options]
 * @param {function(any): ?object} [options.parse]
 * @param {Array<string>} [options.events=['message']]
 */
export declare function eventSourceSource(url: string, options?: object): {
    name: string;
    start(emit: any, notify: any): void;
    stop(): void;
};
/**
 * Polls an async function. The honest choice for health checks and for any
 * backend that has no push channel.
 *
 * @param {function(): Promise<?object>} fn - Resolves to a patch
 * @param {object} [options]
 * @param {number} [options.interval=5000]
 * @param {boolean} [options.immediate=true]
 */
export declare function pollSource(fn: Function, options?: {
    interval?: number;
    immediate?: boolean;
}): {
    name: string;
    start(emit: any, notify: any): void;
    stop(): void;
};

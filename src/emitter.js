/**
 * A ~30-line event emitter. Deliberately not an npm dependency: the whole
 * library is meant to drop into a page with no build step, and one more
 * transitive package is one more reason not to.
 */

export class Emitter {
  constructor() {
    this._handlers = new Map();
  }

  /**
   * Subscribes to an event.
   * @param {string} event
   * @param {function} handler
   * @returns {function(): void} Unsubscribe function.
   */
  on(event, handler) {
    if (typeof handler !== 'function') throw new TypeError('on(event, handler): handler must be a function');
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(handler);
    return () => this.off(event, handler);
  }

  /** Subscribes for exactly one delivery. */
  once(event, handler) {
    const off = this.on(event, (payload) => { off(); handler(payload); });
    return off;
  }

  /** Unsubscribes a handler (or every handler for the event). */
  off(event, handler) {
    if (!this._handlers.has(event)) return;
    if (!handler) { this._handlers.delete(event); return; }
    this._handlers.get(event).delete(handler);
  }

  /**
   * Emits an event. A throwing handler never breaks the emit loop or the
   * render that triggered it — it is reported on the `error` channel instead.
   */
  emit(event, payload) {
    const set = this._handlers.get(event);
    if (!set || set.size === 0) return 0;
    let delivered = 0;
    for (const handler of Array.from(set)) {
      try { handler(payload); delivered++; } catch (err) {
        if (event === 'error') continue; // never recurse
        this.emit('error', { source: `handler:${event}`, error: err });
      }
    }
    return delivered;
  }

  /** Drops every subscription. */
  clear() { this._handlers.clear(); }
}

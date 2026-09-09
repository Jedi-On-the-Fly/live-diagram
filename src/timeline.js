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
export function normalizeEvents(events) {
  const list = (Array.isArray(events) ? events : [])
    .filter((e) => e && typeof e === 'object')
    .map((e) => {
      const at = Number(e.t != null ? e.t : e.time != null ? e.time : e.timestamp);
      const patch = e.patch && typeof e.patch === 'object'
        ? e.patch
        : (e.node ? { [e.node]: pick(e) } : {});
      return { at: Number.isFinite(at) ? at : 0, patch, label: e.label == null ? '' : String(e.label), raw: e };
    })
    .sort((a, b) => a.at - b.at);

  const t0 = list.length ? list[0].at : 0;
  for (const e of list) e.t = e.at - t0;
  const duration = list.length ? list[list.length - 1].t : 0;
  return { events: list, t0, duration };
}

function pick(e) {
  const entry = {};
  if ('state' in e && e.state != null) entry.state = e.state;
  if ('badge' in e) entry.badge = e.badge;
  if ('data' in e) entry.data = e.data;
  if ('merge' in e) entry.merge = e.merge;
  return entry;
}

export class Timeline {
  /**
   * @param {Array<object>} events
   * @param {object} handlers
   * @param {function(object, object): void} handlers.apply - apply(patch, {index, t, reset})
   * @param {function(): void} [handlers.onReset] - Called before a backwards fold
   * @param {function(object): void} [handlers.onTick] - Called after each seek/step
   * @param {function(): void} [handlers.onEnd]
   */
  constructor(events, handlers) {
    const normalized = normalizeEvents(events);
    this.events = normalized.events;
    this.t0 = normalized.t0;
    this.duration = normalized.duration;
    this._handlers = handlers || {};
    this._cursor = 0;     // number of events already applied
    this._position = 0;   // ms into the timeline
    this._timer = null;
    this._speed = 1;
  }

  get length() { return this.events.length; }
  get position() { return this._position; }
  get index() { return this._cursor; }
  get playing() { return this._timer !== null; }

  /**
   * Moves to time `t` (ms from the start of the timeline) and applies
   * everything up to it.
   * @param {number} t
   */
  seek(t) {
    const target = Math.max(0, Math.min(this.duration, Number(t) || 0));
    if (target < this._position) {
      // Backwards: refold from zero. Correctness beats cleverness here — an
      // "undo" path would have to invert arbitrary data payloads.
      if (this._handlers.onReset) this._handlers.onReset();
      this._cursor = 0;
    }
    while (this._cursor < this.events.length && this.events[this._cursor].t <= target) {
      const event = this.events[this._cursor];
      this._cursor++;
      if (this._handlers.apply) this._handlers.apply(event.patch, { index: this._cursor - 1, t: event.t, event });
    }
    this._position = target;
    if (this._handlers.onTick) this._handlers.onTick({ position: target, index: this._cursor, duration: this.duration });
    return this;
  }

  /**
   * Applies exactly ONE event and moves the position onto it.
   *
   * Deliberately not `seek(next.t)`: several events can share a timestamp, and
   * a "next" button that sometimes advances by three is a confusing button.
   * @returns {boolean} False when there is nothing left.
   */
  step() {
    if (this._cursor >= this.events.length) return false;
    const event = this.events[this._cursor];
    this._cursor++;
    if (this._handlers.apply) this._handlers.apply(event.patch, { index: this._cursor - 1, t: event.t, event });
    this._position = event.t;
    if (this._handlers.onTick) this._handlers.onTick({ position: event.t, index: this._cursor, duration: this.duration });
    return true;
  }

  /** Rewinds to the beginning (an empty diagram). */
  reset() {
    if (this._handlers.onReset) this._handlers.onReset();
    this._cursor = 0;
    this._position = 0;
    if (this._handlers.onTick) this._handlers.onTick({ position: 0, index: 0, duration: this.duration });
    return this;
  }

  /**
   * Plays from the current position.
   * @param {object} [options]
   * @param {number} [options.speed=1] - Wall-clock multiplier
   * @param {number} [options.fps=30]
   * @param {boolean} [options.loop=false]
   */
  play(options) {
    const opts = options || {};
    this._speed = Number(opts.speed) > 0 ? Number(opts.speed) : 1;
    const fps = Number(opts.fps) > 0 ? Number(opts.fps) : 30;
    const stepMs = 1000 / fps;
    if (this._position >= this.duration) this.reset();
    this.pause();
    this._timer = setInterval(() => {
      const next = this._position + stepMs * this._speed;
      this.seek(next);
      if (this._position >= this.duration) {
        this.pause();
        if (opts.loop) { this.reset(); this.play(opts); return; }
        if (this._handlers.onEnd) this._handlers.onEnd();
      }
    }, stepMs);
    // Never hold a Node process open for a replay animation.
    if (this._timer && typeof this._timer.unref === 'function') this._timer.unref();
    return this;
  }

  /** Stops playback, keeping the position. */
  pause() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    return this;
  }

  /** Stops playback and rewinds. */
  stop() { return this.pause().reset(); }

  /** Releases the timer. */
  destroy() { this.pause(); this._handlers = {}; this.events = []; }
}

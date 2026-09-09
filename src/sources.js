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
export function webSocketSource(url, options) {
  const opts = options || {};
  const parse = opts.parse || ((msg) => msg);
  const retryMs = opts.retryMs == null ? 2000 : Number(opts.retryMs);
  let socket = null;
  let retry = null;
  let stopped = false;

  return {
    name: 'websocket',
    start(emit, notify) {
      stopped = false;
      const open = () => {
        if (stopped) return;
        socket = new WebSocket(url, opts.protocols);
        socket.addEventListener('open', () => notify && notify('open'));
        socket.addEventListener('message', (event) => {
          let payload = event.data;
          try { payload = JSON.parse(event.data); } catch (_) { /* plain text is allowed */ }
          const patch = parse(payload);
          if (patch) emit(patch);
        });
        socket.addEventListener('close', () => {
          notify && notify('close');
          if (!stopped && retryMs > 0) retry = setTimeout(open, retryMs);
        });
        socket.addEventListener('error', (err) => notify && notify('error', err));
      };
      open();
    },
    stop() {
      stopped = true;
      if (retry) { clearTimeout(retry); retry = null; }
      if (socket) { try { socket.close(); } catch (_) { /* already gone */ } socket = null; }
    }
  };
}

/**
 * Server-Sent Events.
 * @param {string} url
 * @param {object} [options]
 * @param {function(any): ?object} [options.parse]
 * @param {Array<string>} [options.events=['message']]
 */
export function eventSourceSource(url, options) {
  const opts = options || {};
  const parse = opts.parse || ((msg) => msg);
  const names = opts.events || ['message'];
  let es = null;

  return {
    name: 'eventsource',
    start(emit, notify) {
      es = new EventSource(url);
      for (const name of names) {
        es.addEventListener(name, (event) => {
          let payload = event.data;
          try { payload = JSON.parse(event.data); } catch (_) { /* plain text is allowed */ }
          const patch = parse(payload);
          if (patch) emit(patch);
        });
      }
      es.addEventListener('open', () => notify && notify('open'));
      es.addEventListener('error', (err) => notify && notify('error', err));
    },
    stop() { if (es) { es.close(); es = null; } }
  };
}

/**
 * Polls an async function. The honest choice for health checks and for any
 * backend that has no push channel.
 *
 * @param {function(): Promise<?object>} fn - Resolves to a patch
 * @param {object} [options]
 * @param {number} [options.interval=5000]
 * @param {boolean} [options.immediate=true]
 */
export function pollSource(fn, options) {
  const opts = options || {};
  const interval = Number(opts.interval) > 0 ? Number(opts.interval) : 5000;
  let timer = null;
  let stopped = false;

  return {
    name: 'poll',
    start(emit, notify) {
      stopped = false;
      const tick = async () => {
        if (stopped) return;
        try {
          const patch = await fn();
          if (patch) emit(patch);
        } catch (err) {
          notify && notify('error', err);
        }
        // Chained timeout, not setInterval: a slow poll must not stack.
        if (!stopped) timer = setTimeout(tick, interval);
      };
      if (opts.immediate === false) timer = setTimeout(tick, interval); else tick();
    },
    stop() { stopped = true; if (timer) { clearTimeout(timer); timer = null; } }
  };
}

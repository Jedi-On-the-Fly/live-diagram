/**
 * React bindings — `live-diagram/react`.
 *
 * The core is a plain class on purpose, and an effect is genuinely all it
 * takes. This exists because "genuinely all it takes" still means deciding
 * where the instance lives, when to rebuild it, and remembering to destroy it —
 * three decisions per adopter, answered identically every time.
 *
 * React is a peer dependency; nothing else here imports it.
 */

import { createElement, useEffect, useRef, useState } from 'react';
import { LiveDiagram } from '../src/index.js';

/** Cheap structural identity: rebuild when the shape changes, not when a parent re-renders. */
function signature(value) {
  try { return JSON.stringify(value); } catch (_) { return String(value); }
}

/**
 * Mounts a diagram into a ref'd element and keeps it alive across renders.
 *
 * @param {object} ref - A React ref pointing at the container element
 * @param {object} options - LiveDiagram options, minus `mount`
 * @returns {?LiveDiagram} The instance, once mounted
 */
export function useLiveDiagram(ref, options) {
  const opts = options || {};
  const [diagram, setDiagram] = useState(null);
  const handlers = useRef({});
  handlers.current = {
    onNodeClick: opts.onNodeClick,
    onNodeHover: opts.onNodeHover,
    onChange: opts.onChange,
    onError: opts.onError,
    onReady: opts.onReady
  };

  // Only structure rebuilds. State changes go through patch(), which is the
  // whole point of the library — re-creating the instance would throw away the
  // rendered SVG and the repaint fast path with it.
  const build = signature([
    opts.graph, opts.states, opts.theme, opts.controls,
    opts.showIcons, opts.viewport, opts.defaultState, opts.extendStates
  ]);

  useEffect(() => {
    if (!ref.current) return undefined;
    const instance = new LiveDiagram({ ...opts, mount: ref.current });

    instance.on('nodeClick', (p) => handlers.current.onNodeClick && handlers.current.onNodeClick(p));
    instance.on('nodeHover', (p) => handlers.current.onNodeHover && handlers.current.onNodeHover(p));
    instance.on('change', (p) => handlers.current.onChange && handlers.current.onChange(p));
    instance.on('error', (p) => handlers.current.onError && handlers.current.onError(p));
    instance.once('render', () => handlers.current.onReady && handlers.current.onReady(instance));

    setDiagram(instance);
    return () => { instance.destroy(); setDiagram(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, build]);

  return diagram;
}

/**
 * The component form.
 *
 * ```jsx
 * <LiveDiagramView
 *   graph={graph}
 *   patch={{ build: 'success', test: { state: 'running', badge: '4.2s' } }}
 *   onNodeClick={({ id }) => select(id)}
 *   style={{ height: 420 }}
 * />
 * ```
 *
 * `patch` is declarative: pass the state you want, and the component applies it
 * whenever it changes. Imperative work (timelines, sources) belongs on the
 * instance, which `onReady` hands you.
 */
export function LiveDiagramView(props) {
  const {
    graph, states, initial, theme, controls, showIcons, viewport, defaultState, extendStates,
    patch, className, style, onNodeClick, onNodeHover, onChange, onError, onReady, ...rest
  } = props;

  const ref = useRef(null);
  const diagram = useLiveDiagram(ref, {
    graph, states, initial, theme, controls, showIcons, viewport, defaultState, extendStates,
    onNodeClick, onNodeHover, onChange, onError, onReady
  });

  const applied = signature(patch);
  useEffect(() => {
    if (diagram && patch) diagram.patch(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagram, applied]);

  return createElement('div', {
    ref,
    className,
    // A container with no height renders an invisible diagram; give it one the
    // caller can still override.
    style: { height: 420, ...(style || {}) },
    ...rest
  });
}

export default LiveDiagramView;

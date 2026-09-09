---
name: live-diagram-troubleshoot
description: Diagnose a live-diagram that renders nothing, ignores clicks, misplaces badges, flashes on every update, or shows stale data as current. Use when a diagram is already wired up but behaving wrongly.
---

# Diagnosing a live-diagram

> Written against live-diagram 0.4.x — re-read this skill when the minor version moves.

Work top-down: the failures below are ordered by how often they are the real cause. Each has
a one-line check before any fix.

## Nothing renders — an empty box

1. **Is Mermaid there?** `typeof window.mermaid` in the console. It must load **before** the
   library is used. This is the most common cause by a wide margin, and it fails silently on
   the hydration path except for one console line.
2. **Did the mount element exist?** The constructor throws
   `LiveDiagram: mount target "…" not found` — check the console rather than the page.
3. **Is the container zero-height?** `.ld` fills its parent. A `<div id="x">` with no height
   renders a diagram nobody can see. Give the container an explicit height (the custom
   element defaults to `420px`; the class does not).
4. **Did the render throw?** Subscribe before it can:
   `diagram.on('error', (e) => console.error(e.source, e.error))`. A Mermaid syntax error
   arrives here, not as an exception.
5. **Print what was sent to Mermaid:** `diagram.definition()` returns the current source.
   Paste it into the Mermaid live editor — if it fails there, the problem is the definition,
   not the library.

## The fence in my docs site did not become a diagram

- `data-auto` must be on the **library's own** script tag, not Mermaid's.
- **A single-page docs site hydrates once.** Call `LiveDiagram.hydrate(document)` after each
  route change — VitePress, Docusaurus and Astro with view transitions all need this.
- The block is marked `data-ld-hydrated` once seen; a **broken spec is complained about once
  and the source block stays visible**, deliberately. Check the console for
  `neither valid JSON nor Mermaid source`.
- Some Markdown pipelines strip the language class. Fall back to the
  `<script type="application/live-diagram+json">` form, which nothing strips.

## Clicks do nothing

1. `document.querySelectorAll('[data-ld-node]').length` — if it is 0, the SVG rendered but
   nodes were not matched back to ids. That is a renderer-tagging problem; report the
   Mermaid version.
2. Are you listening on the right thing? The class emits `nodeClick`; the **custom element**
   emits a lowercase bubbling DOM event `nodeclick`, and the React binding takes
   `onNodeClick`. Mixing them is a silent no-op.
3. Do not use Mermaid `click` directives — the library delegates from the container instead,
   which is what makes clicks survive a re-render.
4. Nodes are real buttons: Enter and Space fire too. If keyboard works and mouse does not,
   something above is swallowing pointer events.

## A patch does nothing

- **Unknown node.** `diagram.on('warning', console.log)` reports
  `{type: 'unknown-nodes', nodes: [...]}`. Pass `strict: true` in development to make it
  throw instead.
- **Edge, not node.** Edges are addressed `from->to` (or the explicit `id`, or `from->to#2`
  for a parallel edge). `diagram.graph.edges.map((e) => e.id)` lists the real ones.
- **The state name is not in the vocabulary.** An unknown state applies but styles as
  nothing, so the box does not change. `Object.keys(diagram.states)` is the list.
- **No actual change.** Patching a node to the state it is already in is a no-op by design —
  no event, no repaint.

## The diagram flashes, or the layout jumps, on every update

A state change should take the **fast path**: it restyles the existing SVG in place. A full
re-render (re-parse, re-layout) happens only on a structural change.

- **`showIcons: true` costs you the fast path** — the icon is part of the label, so every
  state change re-lays-out the diagram. That is the trade; badges are the cheap alternative.
- Re-creating the instance on every render (a React `useEffect` with the wrong deps, a
  framework that rebuilds on state) throws away everything. State goes through `patch()`;
  only `graph` and `states` should ever rebuild.
- `diagram.on('render', …)` firing on every tick confirms it; `restyle` is the one you want.

## Badges or overlays sit in the wrong place

- They are HTML positioned over the SVG, synced after render and after zoom. If they lag,
  something resized the container without a render — call `diagram.fit()` or `render()`.
- The viewport pads 12px so a chip that sits half outside its node's box is not clipped.
  A custom container with `overflow: hidden` and no padding will clip them.
- An overlay whose node is not in the current graph hides itself; it does not error.

## The diagram is too small, or marooned in the middle of the panel

`fit()` may upscale, but is capped at `maxFitScale` (default 1.75) — a four-node diagram
stretched across a widescreen looks like a mistake. A short, wide graph (a state machine, a
five-stage pipeline) often wants more:

```js
new LiveDiagram({ …, viewport: { maxFitScale: 3 } });
```

`autoFit: true` fits **once**, after the first render — after a container resize, call
`fit()` yourself, or construct with `autoFit: 'observe'` (element: `fit="observe"`) and the
diagram refits itself until the user zooms by hand. (`setGraph()` re-runs the auto-fit.)

**A diagram sitting off-centre, or scrollbars into empty space** was a real bug in 0.4.x —
zoom was a CSS transform, which scales pixels but not the layout box, so centering and
scroll extents disagreed with what you saw. Fixed in 0.5: zoom now resizes the svg's own
width (no transform anywhere), so if you see this, upgrade — and never size the svg inside
`.ld` from your own CSS; its inline width is the zoom mechanism.

## Edges are not picking up their state

- Confirm the ids: `diagram.graph.edges.map((e) => e.id)`.
- A vocabulary entry with no `edgeStyle` borrows the node's stroke colour. If your state
  declares a fill but no stroke, the edge gets nothing — add `edgeStyle` explicitly.
- `.ld-edge` **transitions** `stroke`, so the computed value only equals the target after
  the transition finishes. A test reading it immediately reads a blended colour — wait a
  frame or two.

## It shows old data as if it were current

This is the failure the connection machinery exists to prevent, and it is almost always a
missing `backfill`:

```js
diagram.connect(source, {
  backfill: () => fetch(`/runs/${id}`).then((r) => r.json()),
  staleAfter: 30000
});
```

- `diagram.connection` is `'live' | 'stale' | 'none'`; `diagram.lastUpdate` is a timestamp.
  The root carries `data-ld-connection`, and the canvas, badges and overlays dim together
  with a label (`--ld-stale-opacity` to tune, `staleLabel` to reword).
- A diagram with **no** source reports `'none'` and is never dimmed — that is correct, not a
  bug: nothing claimed to be live.
- Detaching the last source leaves the diagram **stale**, not fresh. The reason it stopped
  makes no difference to someone reading old data.
- `markStale: false` opts out, for callers who render their own connection UI.

## The export is blank, or refuses

- `toPNG` **refuses** a diagram whose Mermaid labels are `foreignObject` HTML — they cannot
  be rasterised from an SVG data URL. Render with
  `mermaidRenderer({ svgLabels: true })` and it works.
- `toSVG` redraws badges into the SVG; overlays are your HTML and are **not** included.
- In a sandboxed page (an artifact viewer, some CSP setups) a script-driven download is
  inert. Put the content on the page instead of offering a dead link.

## Two diagrams on one page, one of them vanishes

Fixed in the library — each render gets a unique id — but if you have wrapped Mermaid
yourself, never share a render id between containers: Mermaid tears the other container's
SVG out of the document.

## When you need to report it

Include: the library version (`LiveDiagram.VERSION`), the Mermaid version
(`mermaid.version`), the output of `diagram.definition()`, and whether the same definition
renders in the Mermaid live editor. That last one splits the problem in half immediately.

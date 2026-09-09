---
name: live-diagram-embed
description: Put a live-diagram into any documentation site, web page, app or framework — pick the cheapest of the three integration paths, wire state in and clicks out. Use when someone wants a Mermaid diagram that shows status, is clickable, or replays a run.
---

# Embedding live-diagram

> Written against live-diagram 0.4.x — re-read this skill when the minor version moves.

`live-diagram` turns a Mermaid diagram into a live control surface: push state in with
`patch()`, get node clicks out, replay a recorded run. MIT, no runtime dependencies,
Mermaid is an optional peer, no build step required.

**Use it when** a diagram should show status, respond to clicks, or replay something that
happened — pipelines, workflows, service health, state machines, lineage.
**Do not use it** for a static picture (a plain mermaid fence is better and lighter), for
editing diagrams (there is no editor), or as a workflow engine (it renders state; it never
decides state).

## Step 1 — pick the cheapest path that fits

Work down this list and stop at the first one that fits. Each step below is more code than
the one above it, and adopters who start at the bottom usually did not need to.

| Situation | Path |
|---|---|
| A docs site, wiki, blog, CMS — anywhere the author writes Markdown | **Hydration** |
| An HTML page, or a framework whose templates you control | **The custom element** |
| React | **`live-diagram/react`** |
| You need the instance itself — sources, timelines, overlays, exports | **The class** |

Mermaid must load **before** the library, on every path.

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js"></script>
<script src="https://unpkg.com/live-diagram/dist/live-diagram.umd.min.js"></script>
```

For bundlers: `npm install live-diagram` (`mermaid` and `react` are optional peers).

## Step 2 — wire it

### Hydration (docs sites)

Two script tags site-wide, then the author writes a fence. Add `data-auto` to the library's
script tag and it hydrates on load:

```html
<script src="https://unpkg.com/live-diagram/dist/live-diagram.umd.min.js" data-auto></script>
```

Then, in any page:

````markdown
```live-diagram
{"graph": "flowchart LR\n  build[Build] --> test[Test] --> ship([Ship])",
 "initial": {"build": "success", "test": "running"},
 "height": "320px"}
```
````

The block may also be a `<script type="application/live-diagram+json">` element or a
`data-live-diagram='{…}'` attribute — whichever survives the site's Markdown pipeline. The
payload is `{graph, states?, initial?, events?, height?, theme?, controls?, autoplay?}`, or
a bare graph. A spec with `events` and no `autoplay` shows the recorded **end** state, so
the diagram says something the moment it is seen.

**Single-page docs sites (VitePress, Docusaurus, Astro with view transitions) must call
`LiveDiagram.hydrate(document)` after each route change** — `data-auto` only fires once, on
first load. The `integrations/` folder in the repo has the config snippet for each.

### The custom element

```html
<live-diagram height="380px" controls
  graph='flowchart LR
    build[Build] --> test[Test] --> ship([Ship])'></live-diagram>
```

Also takes `src` (a URL returning the spec as JSON), `states`, `initial`, `theme`,
`direction`, `default-state`, `fit="observe"` (keep refitting as the container resizes, until
the user zooms by hand), and the flags `icons`, `bare`, `no-fit`, `autoplay`, `loop`.
It emits **bubbling DOM events** — `nodeclick`, `nodehover`, `statechange`, `ready`,
`diagramerror` — so a listener can be attached from a framework that never imports the
library. It forwards `patch()`, `snapshot()`, `restore()`, `timeline()`, `connect()`, `fit()`.

### React

```jsx
import { LiveDiagramView } from 'live-diagram/react';

<LiveDiagramView graph={graph} patch={statePatch} controls
  onNodeClick={({ id }) => open(id)} style={{ height: 380 }} />
```

`patch` is a prop, not a rebuild: changing it pushes state through `patch()` and repaints.
Only a change of `graph` or `states` re-creates the instance. `useLiveDiagram(ref, options)`
is there when you need the instance.

### The class

```js
const diagram = new LiveDiagram({
  mount: '#diagram',
  graph: `flowchart LR
    build[Build] --> test[Test] --> ship([Ship])`,
  controls: true
});

diagram.patch({ build: 'success', test: { state: 'running', badge: '4.2s' } });
diagram.patch({ 'build->test': 'success' });        // edges carry state too
diagram.on('nodeClick', ({ id, state }) => run(id));
```

## Step 3 — the three rules that prevent most mistakes

1. **`patch()` is the only way state changes.** Never reach into the SVG. One door is what
   makes replay, live streaming and run diffing the same feature.
2. **Structure is not state.** The graph says what the boxes *are*; the state channel says
   how they are doing. Keep node ids stable and let state move.
3. **Status is config.** A new status is a new key in the `states` vocabulary, with a light
   and a dark treatment — never a branch in a render function:

```js
states: {
  degraded: { label: 'Degraded', icon: '▲',
              style: 'fill:#fef9c3,stroke:#ca8a04,color:#713f12',
              darkStyle: 'fill:#854d0e,stroke:#facc15,color:#fef9c3' }
}
```

The built-in vocabulary is `idle | queued | running | waiting | success | error | skipped`;
yours merges over it unless you pass `extendStates: false`. Colours may be written as
`rgb()` / `rgba()` / `hsl()` — the vocabulary rewrites them to hex at construction, because
Mermaid's style grammar cannot parse a comma inside a declaration.

## Step 4 — the things people ask for next

- **A live feed.** `diagram.connect(source, { backfill, staleAfter })` where a source is
  anything with `start(emit, notify)` and `stop()`. `webSocketSource`, `eventSourceSource`
  and `pollSource` ship. Always pass `backfill` — see the note below.
- **A recorded run.** `diagram.timeline(events).play({ speed: 2 })`, plus `seek`, `step`,
  and `LiveDiagram.transport(diagram, timeline, { mount })` for the buttons.
- **Anything anchored to a node.** `diagram.overlay(id, htmlOrElement, { position })` —
  a progress bar, a sparkline, a retry button, a line of streaming output. Nine anchor
  points; it returns the element, because you keep updating it.
- **A legend or an inspector.** `LiveDiagram.legend(diagram, { mount })` and
  `LiveDiagram.inspector(diagram, { mount })` (or `{ mode: 'tooltip' }`) are built from the
  vocabulary the diagram already holds, so they cannot drift out of step with it.
- **A picture, or a link.** `toSVG(diagram)`, `toPNG(diagram)`, `download(...)`,
  `shareUrl(diagram)` / `applyShared(diagram)` for a URL that restores the current state.

## The one correctness trap

A socket that drops and reconnects does **not** bring the missed events with it. A diagram
that keeps rendering the last thing it heard is confidently wrong, which is worse than
blank. So on any live feed:

```js
diagram.connect(socketSource, {
  backfill: () => fetch(`/runs/${id}`).then((r) => r.json()),   // ask for the truth
  staleAfter: 30000                                            // and say so meanwhile
});
```

The library dims the canvas, badges and overlays together and shows a label while the feed
is down (`data-ld-connection="stale"` on the root, `--ld-stale-opacity` to taste), then
restores the backfilled snapshot on reconnect. Skipping `backfill` is the single most
common way to ship a diagram that lies.

## Checks before calling it done

- Mermaid loads before the library — a missing Mermaid tag leaves a silent empty box.
- Node ids match `[A-Za-z_][A-Za-z0-9_]*`; the library refuses anything else loudly at
  construction. Edge ids are `from->to`.
- The diagram says something **at rest**, before anyone clicks: an initial patch, or a
  timeline seeked to its end.
- Both themes were looked at. `theme: 'auto'` follows `data-theme` on `<html>`, then
  `prefers-color-scheme`; call `setTheme()` when your own toggle flips. `setTheme()` themes
  the diagram box only, never the host page — set `--ld-bg` on an ancestor (default
  transparent) so the surface follows your page's own dark class; node/edge colours come from
  the vocabulary's `style`/`darkStyle`, never from CSS.
- A diagram in a resizable panel uses `autoFit: 'observe'` (element: `fit="observe"`) — it
  refits on container resize and yields permanently to the user's first hand zoom.
- `destroy()` runs on unmount in any SPA — it detaches sources, timers, listeners and DOM.

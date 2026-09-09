# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/).

## [Unreleased]

The fit/zoom changes below are observable behavior: the next release is a **minor** (0.5.0).

### Fixed

- **Fit and zoom geometry, from the root.** Zoom was a CSS transform, which scales pixels but
  not the layout box — so grid centering centred the unscaled box (a fitted diagram sat visibly
  off-centre), scrollbars tracked a phantom box (2054px of scrollable space for 609px of
  content), and Mermaid's `width="100%"` collapsing to the CSS 300×150 replaced-element default
  meant small diagrams were silently inflated, defeating the `maxFitScale` cap (a 117px diagram
  rendered at 4.5× natural). Zoom now resizes the svg's own width from its viewBox — no
  transform anywhere — so the layout box IS the visual box, everywhere, in both directions.
  `fit()` may also go below the interactive `min` now: min bounds hand zoom, not fitting, so a
  tall diagram in a short container actually fits. The scale survives re-renders (the svg is
  replaced; the viewport re-projects onto the new one, silently, before overlays position) and
  exports no longer inherit the viewer's zoom. A hidden or collapsed container changes nothing —
  it used to snap the scale to 1.

- **`rgba()` and `hsl()` colours no longer break a vocabulary.** Mermaid's style grammar splits
  declarations on commas, so `fill:rgba(255,0,0,.5)` was a parse error on the full-render path —
  and this library's own repaint path split the same way, applying `fill:rgba(255` and calling it
  done. Functional colours are now rewritten to hex once, in `normalizeStates` (8-digit hex is the
  same colour and parses everywhere), and `parseStyle` splits only at top level, so a colour any
  stylesheet would accept no longer needs converting by hand. A colour that cannot be converted —
  `var()`, a `turn` hue — is left exactly as written rather than half-translated.
- **The graph really is frozen now.** `normalizeGraph` froze the containers but not the node, edge
  and group objects inside them, so `graph.nodes.build.label = '…'` mutated silently — one level
  shallower than the documentation promised. Everything is frozen now except `node.meta`, which is
  declared as the caller's own object and stays theirs to mutate.

- **The demo Theme button reaches the diagram again.** `boot.js` looked for `window.diagram`,
  but three demos store their instance as `window.chart` — dodging the `id="diagram"`
  element-global trap the docs themselves warn about — so their toggle threw and left the
  diagram half-themed against a flipped page. A new demo smoke suite
  (`test/demos.browser.test.mjs`) now loads every shipped page and asserts the diagram's
  theme follows the page's.

### Changed

- **Size budgets raised: `umd.js`/`cjs` 48 → 49 KB, `esm.js` 47 → 48 KB gzip** (the minified
  bundle stays at 23). Signed for on 2026-09-07 to admit the fit-geometry rework and
  `autoFit: 'observe'` — about 1.1 KB of real feature code against 0.2 KB of headroom.

### Added

- **`autoFit: 'observe'`** (element: `fit="observe"`): a ResizeObserver keeps the diagram
  fitted as its container resizes — debounced, silent when nothing changes, cancelled
  permanently by the user's first hand zoom (wheel, buttons or `zoomIn()`), disconnected on
  `destroy()`, and never armed in bare mode, where the scroller is the content-sized root and
  observing it would ratchet. Environments without ResizeObserver keep fit-once.
- **`--ld-bg`** paints the diagram surface (default transparent — nothing changes until you set
  it). One custom property on any ancestor and the diagram's ground follows the host page's
  theme; `setTheme()` keeps theming the diagram box only.
- **The DOM contract is documented** (README "The DOM contract"): the `.ld` structure, which
  inline styles the library owns (the svg width — it IS the zoom), the custom properties, and
  why node colours live in the vocabulary rather than CSS. A new drift suite holds the
  documented names to `src/styles.js`.
- **`scripts/vendor-mermaid.js`** fetches the pinned Mermaid build into `demo/vendor/` (a no-op
  once it is there), and `npm run test:browser` and `npm run demo` run it first — so the browser
  suite and the demo pages touch the network once per clone instead of on every page load, and
  work offline after that. A failed fetch warns and continues; every page falls back to the CDN.
- **Agent skills, drift-tested.** `skills/` holds four SKILL.md folders — embed, from-data,
  troubleshoot, release — and ships in the npm package. A skill is documentation followed with
  confidence, by an agent, without the sideways glance a human gives a README, so staleness is
  not left to memory: `test/skills.test.js` checks the API facts they state (export names, the
  element's events and forwarded methods, the default vocabulary, quoted error messages, stated
  defaults) against the source, and each skill carries a version line the suite checks against
  `package.json` — a minor bump fails every skill until someone has re-read it.

## [0.4.2] — 2026-09-05

### Fixed

- **A stale diagram no longer shows bright badges over a dimmed picture.** Badges and overlays ride
  a layer above the canvas, and only the canvas was being dimmed when a connection dropped — so a
  crisp `4.2s` sat on top of a diagram the library had just told you not to trust. The whole
  picture dims together now, which is the point of marking it stale at all.

## [0.4.1] — 2026-09-05

Same library, less than half the bytes.

### Added

- **A minified build.** `dist/live-diagram.umd.min.js` is now the file a `<script>` tag and the
  unpkg entry point load: **~21 KB gzipped**, down from ~46 KB, with no API change and nothing
  new to choose between. Comments were ~40% of the shipped bytes; they earn their place in `src/`
  and have no business in a browser.
- **A source map.** `dist/live-diagram.umd.min.js.map` ships beside it with the sources inlined,
  so a stack trace from the minified file still lands on real code.
- **A size budget.** `npm run size` measures every artifact against a ceiling declared in
  `package.json#sizeLimits` and fails when one is breached; CI runs it on every push. Nobody ever
  adds 40 KB — they add 400 bytes forty times. Raising a ceiling is allowed; raising it without
  noticing is not.
- Tests that the minified bundle parses, exports the same names as the source, and — in a real
  browser — renders, patches, badges, overlays and reports clicks. A mangler that renames
  something the DOM reaches by name breaks at render time and nowhere earlier.

### Changed

- `package.json#unpkg` and the `default` export condition point at the minified file. The
  readable `.umd.js`, `.cjs` and `.esm.js` twins stay in the package unchanged, for bundlers and
  for Node, which read them and do not care about bytes.
- Every CDN snippet in the README, `llms.txt`, `starter.html` and the docs-site integrations now
  loads `live-diagram.umd.min.js`.

## [0.4.0] — 2026-09-05

A correctness bug wearing a feature's clothes, a primitive, a second diagram language, and the
way out.

### Added

- **Reconnect and backfill.** `connect(source, {backfill, staleAfter, markStale})`. A socket that
  drops and comes back does not bring the missed events with it, so a diagram that keeps rendering
  is now confidently *wrong*. On every (re)connect the library can ask for the truth
  (`backfill`), and until it arrives the diagram **says** it is out of date rather than showing an
  old run as current: `data-ld-connection` on the root, a dimmed canvas and a label. New
  `connection`, `stale` and `backfill` events, and `diagram.connection` / `diagram.lastUpdate`.
  Detaching the last source leaves the diagram stale, not fresh — the reason it stopped makes no
  difference to someone reading old data.
- **Node overlays.** `overlay(nodeId, content, {position, offset, className, interactive})` anchors
  any element or HTML to a node: a progress bar, a sparkline, a retry button, a line of streaming
  output. Nine anchor points, survives re-renders, follows zoom and pan, and hides itself when its
  node is not in the current graph. It returns the element, because you keep updating it. The
  library positions your element and never draws its contents.
- **State diagrams.** `stateDiagram-v2` source is parsed like a flowchart —  `[*]` terminals per
  scope, transition labels, `state "Label" as id`, descriptions, composite states as groups,
  `<<choice>>` / `<<fork>>` / `<<join>>`, notes read and discarded. A transition naming a composite
  is redirected to that composite's start or stop, in either declaration order. It was a strange
  gap for a library about state.
- **Export and share.** `toSVG` (standalone, with badges redrawn into the SVG since the originals
  are HTML), `toPNG`, `download`, and `encodeState` / `decodeState` / `shareUrl` / `applyShared`
  for "send someone this diagram in this state". `toPNG` refuses HTML labels **by name** rather
  than producing a wordless picture, and `mermaidRenderer({svgLabels: true})` is the one-word fix —
  Mermaid needs `htmlLabels: false` at two levels, which is now the library's problem, not yours.

### Fixed

- A hidden tooltip inspector was visible as an empty chip in the corner: the kit's `display: grid`
  outranked the browser's own `[hidden]` rule.
- An empty node label (a state diagram's start dot, a fork bar) produced a Mermaid syntax error.
- The build now parses what it wrote — a stray backtick in the CSS template literal produced a
  bundle that only failed when a browser loaded it.

## [0.3.0] — 2026-09-05

Three gaps that stood between "interesting" and "usable on my own diagram".

### Added

- **Mermaid source as input.** `graph` accepts a flowchart definition directly —
  `new LiveDiagram({ mount, graph: 'flowchart LR\n build --> test' })` — so the diagram you already
  wrote becomes a live one without being rewritten as JSON. The parser covers shapes, every edge
  form, inline and pipe labels, chains, `&` groups, subgraphs, comments and directives, and
  rewrites ids Mermaid allows but this library cannot (`my-node` → `my_node`, mapping both ends of
  every edge with it). Another diagram type is refused **by name** rather than silently mangled.
  Fenced `live-diagram` blocks and the `<live-diagram graph="…">` attribute accept source too.
- **Edge state.** Edges are addressable (`build->test`, or an explicit `id`) and carry state and
  data through the same `patch()` as nodes: `patch({ 'api->db': 'error' })`. States gained
  `edgeStyle`/`darkEdgeStyle`, derived from the node stroke when a vocabulary does not define them,
  and edges repaint in place like nodes. A `running` edge animates its dash, which is the "traffic
  flowing" look service maps want. New `edgeClick` event and `getEdge(id)`.
- **The kit** — `legend()`, `inspector()` and `transport()`: optional components built from data
  the diagram already holds. They exist because every demo in this repo hand-rolled them, and the
  demos now use these instead. Import them or ignore them; the core does not know they exist.
- **A playground demo**: paste Mermaid, add state, share the URL. It is also the fastest way to
  see what the parser accepts.

### Changed

- `change` events now carry `edgesChanged` alongside `changed`.
- `snapshot()` includes `edges` and `edgeData`; node states stay exactly where they were, so
  anything reading `snapshot().states` is unaffected.
- The infra, state-machine and replay demos lost their hand-written legend and transport.

## [0.2.0] — 2026-09-03

Adoption, not features: the same library, with the four things standing between "interesting" and
"installed".

### Added

- **`<live-diagram>` custom element.** One tag that works in React, Vue, Svelte, Astro, Rails,
  Django and every documentation site. Takes `graph`/`states`/`initial` as JSON attributes or
  properties, `src` for a URL, and emits `nodeclick`, `nodehover`, `statechange` and `ready` as
  ordinary DOM events. Registered automatically by the UMD build; `defineLiveDiagram()` for ESM,
  so importing the library still has no side effects.
- **Hydration.** `hydrate(root)` turns static blocks into diagrams: a
  `<script type="application/live-diagram+json">`, a ```` ```live-diagram ```` fence, or a
  `data-live-diagram` attribute. The fence is recognised wherever the language class lands — on the
  `<code>`, the `<pre>` or a wrapper — which covers markdown-it, Docusaurus, VitePress, Jekyll and
  Hugo. `<script … data-auto>` hydrates on load. A broken spec is logged once and leaves the
  reader's block visible rather than blanking it.
- **`fromGitHubActions(payload, options)`.** Maps a workflow run's `/jobs` response onto a graph,
  a state vocabulary, an initial patch and a replayable timeline. GitHub does not expose `needs:`,
  so stages are inferred from start times and drawn as subgraphs, with edges only where one side is
  a single job — never an invented pairing. Pass `{needs}` for exact edges, or `{mode: 'steps'}` for
  one job's steps.
- **`live-diagram/react`.** `<LiveDiagramView>` and `useLiveDiagram()`, with `patch` as a
  declarative prop. React is an optional peer; nothing else imports it.
- **TypeScript declarations**, generated from the source's own JSDoc, with real types for the graph
  spec and for patches rather than `object`.
- **Release plumbing**: `scripts/set-repo.js` stamps the repository URLs in one command, a Pages
  workflow deploys the demos, a tag-driven workflow publishes to npm with provenance, and
  `RELEASING.md` documents both.
- **`starter.html`** — the whole thing in one file, openable from disk.
- **[integrations/](integrations/)** — Docusaurus, VitePress, MkDocs and Astro guides, each with the
  one-line fix its navigation model needs.
- A GitHub Actions demo page, fed by a real run payload.

### Changed

- Subgraph boxes get a neutral per-theme style instead of Mermaid's default pale yellow;
  `groupStyle: ''` opts out.
- The viewport keeps 12px of padding so a badge on a top-row node is not clipped.
- The build script fails on duplicate top-level names across modules — a flat bundle scope makes
  that a runtime `SyntaxError` otherwise.
- `render()` returns a promise that resolves when *your* render is on screen; overlapping renders
  are serialised rather than racing to write `innerHTML`.

## [0.1.0] — 2026-09-03

First public release. Extracted from a production workflow tool whose primary
interface is a Mermaid flowchart — clicking a node runs it, and the graph is the
UI. Every piece here had to survive that job before it was pulled out.

### Added

- `LiveDiagram` — mount a graph, push state into it, get node events out.
- Declarative state vocabulary (`states`) with light and dark treatments, and a
  usable default vocabulary so a diagram renders before you decide anything.
- `patch()` as the single state entry point, reporting whether a change was
  structural (needs a re-layout) or decorative (needs a repaint).
- The restyle fast path: state changes repaint the existing SVG instead of
  re-parsing the diagram, so a run does not make the canvas flash.
- `timeline(events)` — seek, step, play and loop over a recorded event stream,
  with backwards seeks refolding from zero for correctness.
- Badge overlay: HTML chips positioned over nodes, so a ticking duration never
  re-lays-out the graph.
- Viewport: zoom, fit (never upscales past 100%), drag-to-pan, ⌘/Ctrl+wheel.
- Keyboard and screen-reader support: nodes are focusable buttons with
  `aria-label`s that carry the current state.
- Sources: `webSocketSource` (with reconnection), `eventSourceSource`,
  `pollSource` (chained, never stacking).
- Renderer adapter interface, with `mermaidRenderer` as the first implementation
  and `buildDefinition` usable as a pure function with no DOM.
- `toTimelineEvents(rows, mapping)` and `graphFromEvents(events)`, for turning
  logs you already have into a replayable diagram.
- ESM and UMD builds from a 90-line, dependency-free build script; the UMD file
  works from a `<script>` tag with no toolchain.

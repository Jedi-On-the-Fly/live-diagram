# Working on this repository

Notes for anyone — human or agent — making changes here. Adopters want
[README.md](README.md); this is about the codebase itself.

## Shape

```text
src/            the library. Plain ES modules, no bare imports, no dependencies.
  live-diagram.js   the class: mounting, patching, rendering, teardown
  graph.js state.js states.js timeline.js emitter.js   the DOM-free core
  parse-mermaid.js  Mermaid flowchart source -> a graph spec (pure); dispatches state diagrams
  parse-state.js    stateDiagram-v2 -> the same graph spec (pure)
  parse-common.js   the pieces both parsers need, so neither imports the other
  export.js         SVG/PNG out, share links in and out
  viewport.js overlay.js styles.js element.js hydrate.js   the parts that touch a document
  renderers/    mermaid.js (DOM) and mermaid-def.js (pure: graph + state -> definition)
  adapters/     foreign shapes in, graph + events out
  kit/          optional components (legend, inspector, transport); the core ignores them
react/          the optional React binding; the only file that imports `react`
dist/           generated. Never edit by hand; CI fails if it drifts from src/
test/           *.test.js run in Node; *.browser.test.mjs drive real Chromium
demo/           the pages deployed to GitHub Pages
integrations/   copy-paste guides per docs-site generator
skills/         agent skills (SKILL.md folders); their API claims are drift-tested
                by test/skills.test.js, and each carries a version line the suite
                checks against package.json — bump the minor and they all ask to
                be re-read
```

## Commands

```bash
npm run build        # dist/ (bundler + tsc declarations)
npm test             # Node: the DOM-free core, adapters, the bundle itself, and the
                     # drift checks that hold README/llms.txt/skills to the actual API
npm run test:browser # Playwright: rendering, the element, hydration
                     # (fetches Mermaid into demo/vendor/ on first run; offline after that)
npm run demo         # serve the repo at :8080
```

## Invariants

Break these and something fails quietly rather than loudly, so they are worth knowing.

- **`patch()` is the only way state changes.** New features must not add a second path — replay,
  live sources and diffing all depend on there being exactly one.
- **The graph is never mutated.** `normalizeGraph` freezes it; changes go through `setGraph()`.
- **The core stays DOM-free.** `graph`, `state`, `states`, `timeline`, `emitter` and
  `mermaid-def` must be testable in Node. If a change needs a document, it belongs in the
  renderer, the viewport, the overlay, the element or the hydrator.
- **A state change must not re-render.** It takes the repaint fast path in `_restyle()`. If you
  find yourself calling `render()` for a status change, something is wrong.
- **`dist/` is committed and must match `src/`.** Run `npm run build` before committing.
- **One flat bundle scope.** Two modules cannot both declare `MARK`; the build script fails on
  duplicate top-level names, which is the only thing standing between you and a runtime
  `SyntaxError` in the UMD file.
- **No bare imports in `src/`.** The build script rejects them: the library has no dependencies
  and Mermaid is reachable only from `renderers/mermaid.js`.
- **No default exports.** The bundler supports the syntax this codebase uses and shouts about
  the rest, on purpose.
- **No cycles.** `graph.js` imports the parser, so the parser must not import `graph.js` — it
  carries its own three-line id check instead. The build refuses a cycle outright.
- **The kit stays optional.** Nothing in `src/` outside `kit/` may import from it.

## Testing

Cover new behaviour where it lives: pure logic in a Node suite, anything involving real SVG in a
browser suite. Assertions should describe the behaviour ("a badge-only change is not structural"),
not restate the implementation. When fixing a bug, add the test that would have caught it — several
suites here exist because of exactly one bug each.

## Adding an adapter

Adapters map somebody else's payload onto `{graph, states, initial, events, meta}`; see
`src/adapters/github-actions.js`. Two rules keep them honest: **never invent an edge you cannot
justify** (say so in `meta` when structure is inferred), and **map foreign vocabularies onto states
that already exist**, adding a new state only when nothing fits.

## Style

Comments explain *why*, not what — especially where the obvious approach is wrong. Keep public
methods documented with JSDoc: the TypeScript declarations are generated from it, so a vague
`@param {object}` becomes a vague type for every user.

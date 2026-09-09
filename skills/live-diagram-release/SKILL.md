---
name: live-diagram-release
description: Cut a release of the live-diagram library — the build, test, size-budget and documentation gates in order, and the version parity the test suite enforces. Use when changing or shipping a version of live-diagram itself, not when using it.
---

# Releasing live-diagram

> Written against live-diagram 0.4.x — re-read this skill when the minor version moves.

This is for working **on** the library. If you are putting a diagram into a page, that is a
different job.

## The shape of the thing

- `src/` is plain ES modules, no dependencies, no bare imports. The bundler in
  `scripts/build.js` is under 200 lines and supports exactly the syntax this codebase uses;
  it **shouts** about anything else rather than guessing.
- `dist/` holds four artifacts plus a source map and `dist/types/`:
  `live-diagram.umd.min.js` (what a `<script>` tag and unpkg load), `live-diagram.umd.js`,
  `live-diagram.cjs` (Node's `require`, because the package is `"type": "module"`), and
  `live-diagram.esm.js`.
- **`dist/` is committed** and CI fails if it does not match `src/`. Always rebuild before
  committing.

## The order of operations

```bash
npm run build        # bundle + minify + tsc declarations
npm run size         # gzip budget per artifact
npm test             # Node suites — pure logic, no browser
npm run test:browser # Chromium via Playwright — DOM, SVG, clicks, the fast path
                     # (fetches Mermaid into demo/vendor/ on first run; offline after that)
```

Then look at the demos in a real browser (`npm run demo`). The browser suites cover the
library; the demo pages cover the wiring, and they have caught real breakage the suites did
not.

## What each gate enforces

**The build** rejects a bare import, an aliased export, a default export, and — a real bug
this caught — two top-level names colliding in the flat bundle. It then `vm`-parses every
file it wrote: a stray backtick inside the CSS template literal produces a bundle that is
valid-looking text and a `SyntaxError` at load time, and the browser is a bad place to find
that out.

**`npm run size`** measures each artifact gzipped against a ceiling in
`package.json#sizeLimits` and fails on a breach. Raising a ceiling is allowed — raising it
without noticing is not, so raise it **in the same commit** as the growth that needs it.
Headroom is deliberately thin — `npm run size` prints the current number per artifact — so
a feature that eats what is left is a conversation, not a rubber stamp.

**`test/docs.test.js`** is the documentation gate. It fails when the version in
`package.json`, `src/index.js`'s `VERSION`, the built banner and the CHANGELOG disagree.
That is deliberate: a release with no changelog entry stops at the test, not at a user.

**`test/skills.test.js`** holds the agent skills in `skills/` to the same standard as the
README: the API facts they state — export names, event names, defaults, the vocabulary,
quoted error messages, the version line each one carries — are checked against the source.
A skill that quietly went stale fails in CI, not in someone's session.

**`test/bundle.test.js`** asserts the bundles export exactly what `src/index.js` does,
that the minified build parses and keeps those names through mangling, that no orphan `.d.ts`
survives a deleted source file, and that every path in `package.json#exports` exists.

## Cutting the version

1. Land the change with its tests. Node tests for anything pure; a browser test for anything
   that touches the DOM, SVG, layout or CSS — including a CSS-only fix, which is exactly the
   kind of change that silently regresses.
2. Write the CHANGELOG entry **first**, in prose: what changed, and why it mattered. The
   changelog is the honest record; "various improvements" is a failure to write it.
3. Bump both places — `package.json#version` and `const VERSION` in `src/index.js`. The
   docs test will tell you if you forget one. **On a minor or major bump, update the
   `Written against live-diagram X.Y.x` line in every `skills/*/SKILL.md` in the SAME
   commit** — `test/skills.test.js` compares those lines to `package.json`, so a bump that
   leaves them behind fails the suite (and with it the release run). That failure is the
   designed re-read prompt: while touching the lines, re-check each skill's claims against
   what actually changed.
4. `npm run build && npm run size && npm test && npm run test:browser`.
5. Check the demos and `starter.html` in a browser.
6. Commit `dist/` with the source. Tag `vX.Y.Z`.

`npm run release:patch|minor|major` does build → test → `npm version` → push with tags.
`prepublishOnly` re-runs build, tests and the size check.

## Versioning rules of thumb

- **Patch**: a fix with no API change. A CSS correction counts.
- **Minor**: new API, new export, a new state in the default vocabulary, a new option.
  Anything a user could now write that they could not before.
- **Major**: a rename, a removal, a changed default, a changed event payload. The two
  contract sentences — `patch()` is the only way state changes, the library never mutates
  your graph — are not up for revision.

Adding an export is a minor bump **and** a line in the README API table; the bundle test
proves the export exists, nothing proves it is documented.

## House rules that keep the codebase what it is

- **No runtime dependencies.** Mermaid and React are optional peers. A build step is a
  barrier to adoption; refusing to need one is a feature, not an oversight.
- **Comments earn their place in `src/` and are stripped from the shipped bundle.** Write
  the *why*, especially where the code looks odd — most of those comments record a bug.
- **Record limitations honestly** rather than papering over them: inferred CI edges,
  `toPNG` refusing `foreignObject` labels, the guessed chain in `graphFromEvents`. A
  documented limit is a feature; a hidden one is a support ticket.
- **Anything pure gets a Node test.** The renderer's definition builder is a pure function
  precisely so it can be tested without a browser, a DOM or Mermaid installed.
- **The README states real numbers**, and the size budget keeps them true.

## Consuming projects

Anything vendoring the built file needs a refresh after a release — copy
`dist/live-diagram.umd.min.js` and its `.map`, and record the version where the copy lives
so the answer is in the repo and not in someone's memory. Then re-run that project's browser
checks: a vendored diagram layer is usually the one dependency its own test suite does not
exercise.

# Integrations

Two script tags and one block. That is the whole install on any site that lets you add a script —
no plugin, no build step, no framework.

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js"></script>
<script src="https://unpkg.com/live-diagram/dist/live-diagram.umd.min.js" data-auto></script>
```

`data-auto` hydrates the page once it has loaded. It also accepts `data-fence`,
`data-theme`, `data-height` and `data-controls="false"`.

## The three block forms

**A JSON script block** — the one that survives every Markdown pipeline, because raw HTML passes
through untouched and no highlighter can mangle it. Prefer this one:

```html
<script type="application/live-diagram+json">
{
  "height": "360px",
  "graph": {
    "direction": "LR",
    "nodes": { "build": { "label": "Build" }, "test": { "label": "Test" }, "ship": { "label": "Ship" } },
    "edges": [{ "from": "build", "to": "test" }, { "from": "test", "to": "ship" }]
  },
  "initial": { "build": "success", "test": { "state": "running", "badge": "4.2s" } }
}
</script>
```

**A fenced code block** — nicer to write, and the source stays in the page (hidden) so it is still
in view-source and in your Git history:

~~~markdown
```live-diagram
{ "graph": { "nodes": { "a": "Alpha", "b": "Beta" }, "edges": [{ "from": "a", "to": "b" }] } }
```
~~~

Recognised wherever the language class lands — on the `<code>` (markdown-it, Hugo), the `<pre>`
(Docusaurus), or a wrapping `<div>` (VitePress, Jekyll). A site that strips the class entirely
(MkDocs with Pygments) needs the script-block form.

**The custom element** — for hand-written HTML and components:

```html
<live-diagram height="360px" controls
  graph='{"nodes":{"a":"Alpha","b":"Beta"},"edges":[{"from":"a","to":"b"}]}'></live-diagram>
```

It also takes `src="/data/run.json"`, and its `nodeclick` DOM event works from any framework.

## What a spec may contain

| Key | Meaning |
|---|---|
| `graph` | Required. `{direction, nodes, edges, groups}` — or pass a bare graph as the whole spec |
| `states` | A custom state vocabulary, merged over the defaults |
| `initial` | A patch applied before the first render |
| `events` | `[{t, node, state, badge?}]` — makes the diagram replayable |
| `autoplay`, `speed`, `loop` | Play the events on load instead of showing their end state |
| `height`, `theme`, `controls` | Presentation |

A spec with `events` but no `autoplay` shows the **end state** of what it recorded, so a reader who
never presses anything still sees a finished run rather than an empty diagram.

## Single-page docs sites

Docusaurus and VitePress navigate without reloading, so `data-auto` fires only on the first page.
Call `LiveDiagram.hydrate(document)` after each route change — every folder here shows exactly
where. MkDocs Material with instant loading has the same wrinkle and the same one-line fix.

## Self-hosting instead of a CDN

Copy `node_modules/live-diagram/dist/live-diagram.umd.js` and `node_modules/mermaid/dist/mermaid.min.js`
into your site's static folder and point the two script tags at them. Nothing here needs a CDN, and
a strict `Content-Security-Policy` is the usual reason not to have one.

## Per-tool guides

- [Docusaurus](docusaurus/) — config, the SPA fix, and an MDX component
- [VitePress](vitepress/) — head config and `onAfterRouteChanged`
- [MkDocs](mkdocs/) — `extra_javascript`, and why the script-block form matters with Pygments
- [Astro](astro/) — a component, plus the view-transitions caveat
- **Any other static site** (Jekyll, Hugo, Eleventy, Zola, plain HTML): add the two script tags to
  your layout's `<head>` and use any block form above. No further steps.
- **React**: `import { LiveDiagramView } from 'live-diagram/react'` — see the main README.

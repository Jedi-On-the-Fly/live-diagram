# MkDocs (including Material)

## 1. Load the library

`mkdocs.yml`:

```yaml
extra_javascript:
  - https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js
  - https://unpkg.com/live-diagram/dist/live-diagram.umd.min.js
  - js/live-diagram-init.js
```

MkDocs writes plain `<script src>` tags with no extra attributes, so `data-auto` is not available
here — hydrate from a small file of your own, `docs/js/live-diagram-init.js`:

```js
// Material's instant loading swaps the page without a reload; document$ fires
// on every page, including the first. Without instant loading, the fallback
// listener does the same job.
if (window.document$ && typeof window.document$.subscribe === 'function') {
  window.document$.subscribe(() => window.LiveDiagram && window.LiveDiagram.hydrate(document));
} else {
  document.addEventListener('DOMContentLoaded', () => window.LiveDiagram && window.LiveDiagram.hydrate(document));
}
```

## 2. Write diagrams

**Use the script-block form.** MkDocs highlights fenced blocks with Pygments, which drops the
language class entirely for an unknown lexer — there is nothing left for the hydrator to find:

```html
<script type="application/live-diagram+json">
{
  "height": "340px",
  "graph": {
    "nodes": { "ingest": "Ingest", "clean": "Clean", "load": "Load" },
    "edges": [{ "from": "ingest", "to": "clean" }, { "from": "clean", "to": "load" }]
  },
  "initial": { "ingest": "success", "clean": "running" }
}
</script>
```

Raw HTML passes through the Markdown renderer untouched, so this works in stock MkDocs and in
Material with no extensions enabled.

If you would rather write fences, turn Pygments off for them
(`markdown_extensions: [pymdownx.highlight: {use_pygments: false}]`), which makes pymdownx emit
`<code class="language-live-diagram">` — and the fence form starts working.

## 3. Self-hosting

Drop the two `.js` files in `docs/js/` and list them by relative path instead. MkDocs copies
anything under `docs/` to the built site.

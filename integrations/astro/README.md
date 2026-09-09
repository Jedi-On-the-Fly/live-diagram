# Astro

Astro ships static HTML by default, so the custom element is all you need — no wrapper, no
client directive, nothing to hydrate.

## 1. Load the library

In your layout's `<head>`:

```astro
<script is:inline src="https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js"></script>
<script is:inline src="https://unpkg.com/live-diagram/dist/live-diagram.umd.min.js" data-auto></script>
```

`is:inline` keeps Astro from bundling and reordering them.

## 2. Use it

In `.astro` or `.mdx`:

```astro
<live-diagram
  height="380px"
  controls
  graph={JSON.stringify({
    direction: 'LR',
    nodes: { fetch: { label: 'Fetch' }, build: { label: 'Build' }, deploy: { label: 'Deploy' } },
    edges: [{ from: 'fetch', to: 'build' }, { from: 'build', to: 'deploy' }]
  })}
></live-diagram>
```

Or copy `LiveDiagram.astro` from this folder, which does the `JSON.stringify` for you:

```astro
---
import LiveDiagram from '../components/LiveDiagram.astro';
---
<LiveDiagram graph={{ nodes: { a: 'Alpha', b: 'Beta' }, edges: [{ from: 'a', to: 'b' }] }} height="380px" />
```

## 3. View transitions

With `<ClientRouter />` (formerly `<ViewTransitions />`), pages swap without a reload:

```astro
<script is:inline>
  document.addEventListener('astro:page-load', () => window.LiveDiagram?.hydrate(document));
</script>
```

Custom elements re-upgrade themselves on the new DOM, so this is only needed for the fence and
script-block forms.

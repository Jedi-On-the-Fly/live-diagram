# VitePress

## 1. Load the library

`.vitepress/config.ts`:

```ts
export default {
  head: [
    ['script', { src: 'https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js' }],
    ['script', { src: 'https://unpkg.com/live-diagram/dist/live-diagram.umd.min.js', 'data-auto': '' }]
  ]
}
```

## 2. Re-hydrate on navigation

VitePress is a single-page app. `.vitepress/theme/index.ts`:

```ts
import DefaultTheme from 'vitepress/theme';

export default {
  extends: DefaultTheme,
  enhanceApp({ router }) {
    if (typeof window === 'undefined') return;
    const hydrate = () => requestAnimationFrame(() => window.LiveDiagram?.hydrate(document));
    router.onAfterRouteChanged = hydrate;   // subsequent pages
    hydrate();                              // and the first one
  }
}
```

The `requestAnimationFrame` matters: the route changes before the new page's DOM is in place.

## 3. Write diagrams

VitePress wraps a fenced block in `<div class="language-live-diagram">`, which the hydrator
recognises:

~~~markdown
```live-diagram
{ "graph": { "nodes": { "parse": "Parse", "render": "Render" }, "edges": [{ "from": "parse", "to": "render" }] } }
```
~~~

Shiki will not know the `live-diagram` language and prints a warning at build time. Either ignore
it, or silence it by aliasing the language to JSON in your config:

```ts
markdown: { languageAlias: { 'live-diagram': 'json' } }
```

The class stays `language-live-diagram`, so hydration is unaffected — and you get JSON
highlighting in the source block for free.

Raw HTML also works in VitePress markdown, so `<live-diagram graph='…'>` and the
`<script type="application/live-diagram+json">` form are both available.

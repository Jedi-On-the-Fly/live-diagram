# Docusaurus

## 1. Load the library

`docusaurus.config.js`:

```js
module.exports = {
  scripts: [
    { src: 'https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js', async: false },
    { src: 'https://unpkg.com/live-diagram/dist/live-diagram.umd.min.js', async: false, 'data-auto': '' }
  ]
};
```

`async: false` matters: Mermaid must be there before the library hydrates.

## 2. Re-hydrate on navigation

Docusaurus is a single-page app, so `data-auto` fires once and never again. Swizzle the Root
component — create `src/theme/Root.js`:

```jsx
import React, { useEffect } from 'react';
import { useLocation } from '@docusaurus/router';

export default function Root({ children }) {
  const { pathname } = useLocation();
  useEffect(() => {
    // Already-hydrated blocks are skipped, so calling this on every route is free.
    if (typeof window !== 'undefined' && window.LiveDiagram) window.LiveDiagram.hydrate(document);
  }, [pathname]);
  return <>{children}</>;
}
```

## 3. Write diagrams

In any `.md` or `.mdx` page, either form works — Docusaurus puts the language class on the `<pre>`,
which the hydrator handles:

~~~markdown
```live-diagram
{ "graph": { "nodes": { "build": "Build", "ship": "Ship" }, "edges": [{ "from": "build", "to": "ship" }] } }
```
~~~

## The MDX component

For a diagram driven by page state — one that reacts to a tab, a toggle or live data — use the
component in this folder instead. Copy `LiveDiagram.jsx` into `src/components/`, then:

```mdx
import LiveDiagram from '@site/src/components/LiveDiagram';

<LiveDiagram
  graph={{ nodes: { a: 'Alpha', b: 'Beta' }, edges: [{ from: 'a', to: 'b' }] }}
  patch={{ a: 'success' }}
  height={360}
/>
```

It renders nothing during the static build (`BrowserOnly`), which is what keeps SSR from touching
`document`.

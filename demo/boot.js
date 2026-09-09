/**
 * Shared demo boot: loads Mermaid, then the library, then calls demo().
 *
 * Mermaid comes from a CDN. If you cloned this repo and dropped a copy in
 * demo/vendor/mermaid.min.js (see `npm run vendor`), that one wins so the
 * demos work with no network at all.
 */
(function () {
  var MERMAID_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js';

  function load(src, onload, onerror) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = onload;
    s.onerror = onerror;
    document.head.appendChild(s);
  }

  function start() {
    load('../dist/live-diagram.umd.js', function () {
      document.documentElement.setAttribute('data-theme', theme());
      if (typeof window.demo === 'function') window.demo();
    }, function () {
      document.body.innerHTML = '<p style="padding:2rem;font:14px system-ui">Run <code>npm run build</code> first — the demos load <code>dist/live-diagram.umd.js</code>.</p>';
    });
  }

  function theme() {
    var stored = null;
    try { stored = localStorage.getItem('ld-demo-theme'); } catch (e) { /* private mode */ }
    if (stored) return stored;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  window.toggleTheme = function () {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('ld-demo-theme', next); } catch (e) { /* private mode */ }
    // Some demos store the instance as `chart` — `window.diagram` would be the
    // <div id="diagram"> there (an element id becomes a global), which is the
    // very trap the docs warn adopters about. The typeof guard keeps a page
    // with no diagram (index) quiet.
    var d = window.chart || window.diagram;
    if (d && typeof d.setTheme === 'function') d.setTheme(next);
  };

  load('vendor/mermaid.min.js', start, function () { load(MERMAID_CDN, start); });
})();

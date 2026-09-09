/**
 * The minified build, in a real browser.
 *
 * `npm run size` proves the file is small and `test/bundle.test.js` proves it
 * parses, but neither proves it *runs*: a mangler that renames something the
 * DOM reaches by name breaks at render time and nowhere earlier. This suite
 * loads the exact file a <script> tag downloads and drives it.
 *
 *   npm run test:browser
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };

let server, browser, page, origin;
const consoleErrors = [];

before(async () => {
  server = http.createServer((req, res) => {
    const file = path.normalize(path.join(ROOT, decodeURIComponent(req.url.split('?')[0])));
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  origin = `http://127.0.0.1:${server.address().port}`;

  browser = await chromium.launch(process.env.LD_CHROMIUM ? { executablePath: process.env.LD_CHROMIUM } : {});
  page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e.message)));
  await page.goto(`${origin}/test/fixtures/min.html`);
  await page.evaluate(() => window.__ready);
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
});

test('the minified bundle renders, patches and reports clicks', async () => {
  const result = await page.evaluate(async () => {
    const clicks = [];
    const diagram = new LiveDiagram({
      mount: '#host',
      graph: {
        direction: 'LR',
        nodes: { a: { label: 'Alpha' }, b: { label: 'Beta' }, c: { label: 'Gamma' } },
        edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]
      },
      states: { running: { style: 'fill:#dbeafe', icon: '▶' } }
    });
    diagram.on('nodeClick', (payload) => clicks.push(payload.id));
    await diagram.render();

    diagram.patch({ a: 'success', b: 'running', 'a->b': 'success' });
    diagram.badge('b', '3/7');
    diagram.overlay('c', '<em class="probe">live</em>', { anchor: 'top-right' });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    document.querySelector('#host [data-ld-node="c"]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );

    return {
      version: LiveDiagram.VERSION,
      nodes: document.querySelectorAll('#host [data-ld-node]').length,
      svg: !!document.querySelector('#host svg'),
      badges: document.querySelectorAll('#host .ld-badge').length,
      probe: !!document.querySelector('#host .probe'),
      state: diagram.snapshot().states.b,
      edge: diagram.snapshot().edges?.['a->b'],
      clicks,
      helpers: ['hydrate', 'defineLiveDiagram', 'legend', 'inspector', 'toSVG', 'shareUrl']
        .filter((name) => typeof LiveDiagram[name] === 'function')
    };
  });

  assert.equal(result.svg, true, 'it rendered an SVG');
  assert.equal(result.nodes, 3, 'all three nodes are tagged');
  assert.equal(result.state, 'running');
  assert.equal(result.edge, 'success', 'edge state survived minification');
  assert.ok(result.badges >= 1, 'the badge chip is drawn');
  assert.equal(result.probe, true, 'custom overlays still mount');
  assert.deepEqual(result.clicks, ['c'], 'clicks still reach the listener');
  assert.match(result.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(
    result.helpers,
    ['hydrate', 'defineLiveDiagram', 'legend', 'inspector', 'toSVG', 'shareUrl'],
    'the namespace helpers survive mangling'
  );
});

test('the minified build logs nothing to the console', () => {
  assert.deepEqual(consoleErrors.filter((line) => !/favicon|404/.test(line)), []);
});

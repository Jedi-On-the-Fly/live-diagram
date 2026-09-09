/**
 * The custom element and the hydration scanner — the two integration paths
 * that never touch a bundler, tested the way a docs site would use them.
 *
 *   npm run test:element
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
  page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e.message)));
  await page.goto(`${origin}/test/fixtures/hydrate.html`);
  await page.evaluate(() => window.__ready);
  await page.waitForSelector('#element [data-ld-node="x"]');
});

after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
});

// ---- the custom element ---------------------------------------------------

test('the UMD build registers <live-diagram> without being asked', async () => {
  assert.equal(await page.evaluate(() => !!customElements.get('live-diagram')), true);
});

test('the element renders the graph from its attribute', async () => {
  const found = await page.$$eval('#element [data-ld-node]', (els) => els.map((e) => e.getAttribute('data-ld-node')).sort());
  assert.deepEqual(found, ['x', 'y']);
  assert.equal(await page.$$eval('#element .ld-controls', (e) => e.length), 1, 'the controls attribute reached the instance');
});

test('the element emits a DOM nodeclick event any framework can listen to', async () => {
  const detail = await page.evaluate(async () => {
    const el = document.getElementById('element');
    const seen = new Promise((resolve) => el.addEventListener('nodeclick', (e) => resolve({ id: e.detail.id, state: e.detail.state, bubbles: e.bubbles }), { once: true }));
    el.querySelector('[data-ld-node="y"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return seen;
  });
  assert.deepEqual(detail, { id: 'y', state: 'idle', bubbles: true });
});

test('the element forwards the class API', async () => {
  const state = await page.evaluate(async () => {
    const el = document.getElementById('element');
    el.patch({ x: { state: 'success', badge: '1s' } });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return {
      painted: el.querySelector('[data-ld-node="x"]').getAttribute('data-ld-state'),
      badge: el.querySelector('.ld-badge').textContent,
      snapshot: el.snapshot().states.x
    };
  });
  assert.deepEqual(state, { painted: 'success', badge: '1s', snapshot: 'success' });
});

test('changing the theme attribute restyles instead of rebuilding', async () => {
  const result = await page.evaluate(async () => {
    const el = document.getElementById('element');
    const svg = el.querySelector('svg');
    el.setAttribute('theme', 'dark');
    await new Promise((r) => setTimeout(r, 350));
    return { root: el.querySelector('.ld').getAttribute('data-theme'), sameElement: el.querySelector('svg') !== null };
  });
  assert.equal(result.root, 'dark');
  assert.equal(result.sameElement, true);
});

test('removing the element destroys its diagram', async () => {
  const left = await page.evaluate(() => {
    const el = document.getElementById('element');
    const clone = el.cloneNode(true);
    el.remove();
    const destroyed = el.diagram === null;
    document.body.appendChild(clone);   // put it back for later tests
    return destroyed;
  });
  assert.equal(left, true);
});

test('a graph the element cannot parse says so in the page', async () => {
  const message = await page.evaluate(async () => {
    const el = document.createElement('live-diagram');
    el.setAttribute('graph', '{ nope }');
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 200));
    const text = el.textContent;
    el.remove();
    return text;
  });
  assert.match(message, /not valid JSON/);
});

// ---- hydration ------------------------------------------------------------

test('a JSON script block becomes a diagram', async () => {
  const result = await page.evaluate(async () => {
    window.__mounted = LiveDiagram.hydrate(document);
    await new Promise((r) => setTimeout(r, 700));
    const holder = document.querySelector('script[type="application/live-diagram+json"]').nextElementSibling;
    return {
      nodes: holder.querySelectorAll('[data-ld-node]').length,
      one: holder.querySelector('[data-ld-node="one"]').getAttribute('data-ld-state'),
      height: holder.style.height
    };
  });
  assert.deepEqual(result, { nodes: 2, one: 'success', height: '240px' });
});

test('a ```live-diagram fence becomes a diagram, and its source is kept but hidden', async () => {
  const result = await page.evaluate(() => {
    const code = document.querySelector('code.language-live-diagram');
    const pre = code.closest('pre');
    return {
      hidden: pre.style.display,
      stillThere: code.textContent.includes('"alpha"'),
      nodes: pre.previousElementSibling.querySelectorAll('[data-ld-node]').length
    };
  });
  assert.equal(result.hidden, 'none');
  assert.equal(result.stillThere, true);
  assert.equal(result.nodes, 2);
});

test('a spec carrying events replays, ending on the recorded final state', async () => {
  const states = await page.evaluate(() => {
    const diagram = window.__mounted.find((d) => d.graph.nodes.alpha);
    return diagram.snapshot().states;
  });
  assert.deepEqual(states, { alpha: 'success', beta: 'error' });
});

test('a data-live-diagram attribute hydrates in place, bare graph and all', async () => {
  const nodes = await page.$$eval('[data-live-diagram] [data-ld-node]', (els) => els.map((e) => e.getAttribute('data-ld-node')));
  assert.deepEqual(nodes, ['solo']);
});

test('every static-site generator\'s fence markup is recognised', async () => {
  const found = await page.evaluate(() => {
    const ids = ['docu', 'vite', 'jek', 'hugo'];
    return ids.map((id) => ({
      id,
      mounted: !!document.querySelector(`[data-ld-node="${id}"]`),
      // The original block is hidden, not destroyed, and the wrapper went with it.
      sourceHidden: [...document.querySelectorAll('[data-ld-hydrated]')]
        .some((el) => el.textContent.includes(`"${id}"`) && getComputedStyle(el).display === 'none')
    }));
  });
  for (const row of found) {
    assert.equal(row.mounted, true, `${row.id} rendered`);
    assert.equal(row.sourceHidden, true, `${row.id}'s source block was hidden, not left visible`);
  }
});

test('a broken spec leaves the reader\'s page intact', async () => {
  const broken = await page.evaluate(() => {
    const code = [...document.querySelectorAll('code.language-live-diagram')].find((c) => c.textContent.includes('not json'));
    return { visible: code.closest('pre').style.display !== 'none', text: code.textContent.trim() };
  });
  assert.equal(broken.visible, true, 'the block must stay readable');
  assert.equal(broken.text, '{ this is not json }');
  assert.ok(consoleErrors.some((line) => /valid JSON/.test(line)), 'and it must complain loudly');
});

test('hydrating twice does not double-mount', async () => {
  const count = await page.evaluate(async () => {
    const before = document.querySelectorAll('.ld').length;
    LiveDiagram.hydrate(document);
    await new Promise((r) => setTimeout(r, 300));
    return { before, after: document.querySelectorAll('.ld').length };
  });
  assert.equal(count.after, count.before);
});

test('nothing unexpected reached the console', () => {
  const unexpected = consoleErrors.filter((line) => !/valid JSON|favicon|404/.test(line));
  assert.deepEqual(unexpected, []);
});

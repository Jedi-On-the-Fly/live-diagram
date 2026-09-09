/**
 * Browser tests: everything the Node suites cannot reach — real Mermaid, real
 * SVG, real clicks, and the fast path that repaints instead of re-rendering.
 *
 *   npm run test:browser
 *
 * Chromium comes from Playwright; set LD_CHROMIUM to point at another binary.
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

const GRAPH = {
  direction: 'LR',
  nodes: { a: { label: 'Alpha', shape: 'stadium' }, b: { label: 'Beta' }, c: { label: 'Gamma', shape: 'diamond' } },
  edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c', condition: 'maybe', label: 'if' }]
};

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
  page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e.message)));
  await page.goto(`${origin}/test/fixtures/harness.html`);
  await page.evaluate(() => window.__ready);
  await page.evaluate((graph) => {
    window.events = [];
    window.diagram = new LiveDiagram({ mount: '#host', graph, controls: true });
    window.diagram.on('nodeClick', (payload) => window.events.push(['nodeClick', payload.id, payload.state]));
    window.diagram.on('render', () => window.events.push(['render']));
    window.diagram.on('restyle', () => window.events.push(['restyle']));
    return window.diagram.render();
  }, GRAPH);
  await page.waitForSelector('[data-ld-node="c"]');
});

after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
});

test('mounts an SVG and tags every node', async () => {
  const found = await page.$$eval('[data-ld-node]', (els) => els.map((el) => el.getAttribute('data-ld-node')).sort());
  assert.deepEqual(found, ['a', 'b', 'c']);
  assert.equal(await page.$$eval('#host svg', (els) => els.length), 1);
});

test('nodes are reachable by keyboard and describe their state to a screen reader', async () => {
  const node = await page.$('[data-ld-node="b"]');
  assert.equal(await node.getAttribute('tabindex'), '0');
  assert.equal(await node.getAttribute('role'), 'button');
  assert.equal(await node.getAttribute('aria-label'), 'Beta: Idle');
});

test('clicking a node emits nodeClick with its current state', async () => {
  await page.evaluate(() => { window.events = []; });
  await page.click('[data-ld-node="a"]');
  assert.deepEqual(await page.evaluate(() => window.events), [['nodeClick', 'a', 'idle']]);
});

test('Enter on a focused node emits nodeClick too', async () => {
  await page.evaluate(() => { window.events = []; document.querySelector('[data-ld-node="b"]').focus(); });
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => window.events), [['nodeClick', 'b', 'idle']]);
});

test('a state patch repaints the existing SVG instead of re-rendering it', async () => {
  const result = await page.evaluate(async () => {
    const before = document.querySelector('#host svg');
    const shape = document.querySelector('[data-ld-node="a"]').querySelector('rect, path, polygon, circle, ellipse');
    const fillBefore = getComputedStyle(shape).fill;
    window.events = [];
    window.diagram.patch({ a: 'success' });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return {
      sameSvg: before === document.querySelector('#host svg'),
      fillBefore,
      fillAfter: getComputedStyle(document.querySelector('[data-ld-node="a"]').querySelector('rect, path, polygon, circle, ellipse')).fill,
      state: document.querySelector('[data-ld-node="a"]').getAttribute('data-ld-state'),
      aria: document.querySelector('[data-ld-node="a"]').getAttribute('aria-label'),
      events: window.events.map((e) => e[0])
    };
  });
  assert.equal(result.sameSvg, true, 'the SVG element must survive a state change');
  assert.notEqual(result.fillBefore, result.fillAfter, 'the node repainted');
  assert.equal(result.state, 'success');
  assert.equal(result.aria, 'Alpha: Success');
  assert.deepEqual(result.events, ['restyle'], 'no full render for a state change');
});

test('badges appear over their node and clear with null', async () => {
  const shown = await page.evaluate(async () => {
    window.diagram.badge('b', '1.2s');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const chip = document.querySelector('.ld-badge');
    const node = document.querySelector('[data-ld-node="b"]').getBoundingClientRect();
    const rect = chip.getBoundingClientRect();
    return { text: chip.textContent, near: Math.abs(rect.left - node.right) < 60 && Math.abs(rect.top - node.top) < 60 };
  });
  assert.equal(shown.text, '1.2s');
  assert.equal(shown.near, true, 'the chip sits on the node it belongs to');

  const cleared = await page.evaluate(async () => {
    window.diagram.badge('b', null);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return document.querySelectorAll('.ld-badge').length;
  });
  assert.equal(cleared, 0);
});

test('a timeline replays forwards and backwards', async () => {
  const result = await page.evaluate(async () => {
    const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.diagram.clear();
    const tl = window.diagram.timeline([
      { t: 0, node: 'a', state: 'running' },
      { t: 100, node: 'a', state: 'success' },
      { t: 100, node: 'b', state: 'running' },
      { t: 300, node: 'b', state: 'error' }
    ]);
    tl.seek(tl.duration); await settle();
    const end = window.diagram.snapshot().states;
    tl.seek(0); await settle();
    const start = window.diagram.snapshot().states;
    const painted = document.querySelector('[data-ld-node="b"]').getAttribute('data-ld-state');
    tl.destroy();
    return { end, start, painted };
  });
  assert.deepEqual(result.end, { a: 'success', b: 'error', c: 'idle' });
  assert.deepEqual(result.start, { a: 'running', b: 'idle', c: 'idle' });
  assert.equal(result.painted, 'idle', 'the DOM followed the rewind');
});

test('switching theme re-renders with the dark palette', async () => {
  const result = await page.evaluate(async () => {
    window.diagram.patch({ c: 'error' });
    window.diagram.setTheme('dark');
    await new Promise((r) => setTimeout(r, 300));
    const shape = document.querySelector('[data-ld-node="c"]').querySelector('rect, path, polygon, circle, ellipse');
    return { fill: getComputedStyle(shape).fill, root: document.querySelector('.ld').getAttribute('data-theme') };
  });
  assert.equal(result.root, 'dark');
  // #7f1d1d — the dark error fill, not the light one (#fee2e2).
  assert.equal(result.fill, 'rgb(127, 29, 29)');
});

test('zoom controls exist and change the scale', async () => {
  const scaled = await page.evaluate(async () => {
    const width = () => document.querySelector('.ld-canvas svg').getBoundingClientRect().width;
    const before = { scale: window.diagram.viewport.scale, width: width() };
    document.querySelectorAll('.ld-controls button')[0].click();
    return { before, after: { scale: window.diagram.viewport.scale, width: width() } };
  });
  assert.notEqual(scaled.before.scale, scaled.after.scale);
  assert.notEqual(scaled.before.width, scaled.after.width);
});

test('edges are tagged with their ids', async () => {
  const found = await page.$$eval('[data-ld-edge]', (els) => els.map((e) => e.getAttribute('data-ld-edge')));
  assert.deepEqual(found, ['a->b', 'b->c']);
});

test('an edge state repaints the edge in place, without a re-render', async () => {
  const result = await page.evaluate(async () => {
    // Pin the theme: an earlier test switched it, and the two palettes have
    // different reds.
    await window.diagram.setTheme('light').render();
    await new Promise((r) => setTimeout(r, 250));
    const before = document.querySelector('#host svg');
    const path = document.querySelector('[data-ld-edge="a->b"]');
    const strokeBefore = getComputedStyle(path).stroke;
    window.events = [];
    window.diagram.patch({ 'a->b': 'error' });
    // Long enough for the stroke transition to land: reading the computed
    // value mid-transition returns a blend, which is a great way to write a
    // flaky test.
    await new Promise((r) => setTimeout(r, 300));
    return {
      sameSvg: before === document.querySelector('#host svg'),
      strokeBefore,
      strokeAfter: getComputedStyle(document.querySelector('[data-ld-edge="a->b"]')).stroke,
      state: document.querySelector('[data-ld-edge="a->b"]').getAttribute('data-ld-edge-state'),
      events: window.events.map((e) => e[0])
    };
  });
  assert.equal(result.sameSvg, true);
  assert.notEqual(result.strokeBefore, result.strokeAfter);
  assert.equal(result.strokeAfter, 'rgb(220, 38, 38)');
  assert.equal(result.state, 'error');
  assert.deepEqual(result.events, ['restyle']);
});

test('a dashed state clears when the edge moves on', async () => {
  const dashes = await page.evaluate(async () => {
    const settle = () => new Promise((r) => setTimeout(r, 250));
    window.diagram.patch({ 'a->b': 'skipped' });
    await settle();
    const dashed = document.querySelector('[data-ld-edge="a->b"]').style.strokeDasharray;
    window.diagram.patch({ 'a->b': 'success' });
    await settle();
    return { dashed, after: document.querySelector('[data-ld-edge="a->b"]').style.strokeDasharray };
  });
  assert.match(dashes.dashed, /3\s*,?\s*4/);
  assert.equal(dashes.after, '', 'the dash does not survive the next state');
});

test('clicking an edge emits edgeClick with both ends', async () => {
  const detail = await page.evaluate(async () => {
    const seen = new Promise((resolve) => window.diagram.once('edgeClick', resolve));
    document.querySelector('[data-ld-edge="b->c"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const payload = await seen;
    return { id: payload.id, from: payload.from, to: payload.to, state: payload.state };
  });
  assert.deepEqual(detail, { id: 'b->c', from: 'b', to: 'c', state: 'idle' });
});

test('a running edge is marked for the flow animation', async () => {
  const state = await page.evaluate(async () => {
    window.diagram.patch({ 'b->c': 'running' });
    await new Promise((r) => setTimeout(r, 250));
    const path = document.querySelector('[data-ld-edge="b->c"]');
    return { attr: path.getAttribute('data-ld-edge-state'), animated: getComputedStyle(path).animationName };
  });
  assert.equal(state.attr, 'running');
  assert.equal(state.animated, 'ld-flow');
});

test('Mermaid source can be handed straight to setGraph', async () => {
  const result = await page.evaluate(async () => {
    await window.diagram.setGraph('flowchart TB\n  parse[Parse] --> render[Render] --> paint([Paint])').render();
    return {
      nodes: [...document.querySelectorAll('#host [data-ld-node]')].map((e) => e.getAttribute('data-ld-node')),
      edges: [...document.querySelectorAll('#host [data-ld-edge]')].map((e) => e.getAttribute('data-ld-edge'))
    };
  });
  assert.deepEqual(result.nodes.sort(), ['paint', 'parse', 'render']);
  assert.deepEqual(result.edges, ['parse->render', 'render->paint']);
});

test('a state diagram renders, terminals and composite included', async () => {
  const result = await page.evaluate(async () => {
    await window.diagram.setGraph(`stateDiagram-v2
      direction LR
      [*] --> Idle
      Idle --> Deploy : ship
      state Deploy {
        [*] --> canary
        canary --> [*]
      }
      Deploy --> [*]`).render();
    await new Promise((r) => setTimeout(r, 250));
    window.diagram.patch({ canary: 'running' });
    await new Promise((r) => setTimeout(r, 250));
    return {
      nodes: [...document.querySelectorAll('#host [data-ld-node]')].map((e) => e.getAttribute('data-ld-node')).sort(),
      cluster: document.querySelectorAll('#host .cluster, #host g[id*="Deploy"]').length > 0,
      painted: document.querySelector('[data-ld-node="canary"]').getAttribute('data-ld-state')
    };
  });
  assert.deepEqual(result.nodes, ['Deploy_start', 'Deploy_stop', 'Idle', 'canary', 'start', 'stop']);
  assert.equal(result.cluster, true, 'the composite drew as a subgraph');
  assert.equal(result.painted, 'running', 'and its states are patchable like any other');
});

test('bare mode mounts without chrome, for a host that owns its own scrolling', async () => {
  const result = await page.evaluate(async (graph) => {
    const bare = new LiveDiagram({ mount: '#host2', graph, viewport: false, autoFit: false });
    await bare.render();
    const root = document.querySelector('#host2 .ld');
    const out = {
      chrome: root.getAttribute('data-chrome'),
      scrollers: document.querySelectorAll('#host2 .ld-viewport').length,
      nodes: document.querySelectorAll('#host2 [data-ld-node]').length,
      canvasIsChildOfRoot: root.firstElementChild.className === 'ld-canvas'
    };
    bare.destroy();
    out.after = document.querySelectorAll('#host2 .ld').length;
    return out;
  }, GRAPH);
  assert.equal(result.chrome, 'none');
  assert.equal(result.scrollers, 0, 'no nested scroll container');
  assert.equal(result.nodes, 3);
  assert.equal(result.canvasIsChildOfRoot, true);
  assert.equal(result.after, 0);
});

test('destroy removes everything it added', async () => {
  const left = await page.evaluate(() => {
    window.diagram.destroy();
    return { roots: document.querySelectorAll('.ld').length, badges: document.querySelectorAll('.ld-badge').length };
  });
  assert.deepEqual(left, { roots: 0, badges: 0 });
});

test('nothing was logged to the console during any of that', () => {
  const real = consoleErrors.filter((line) => !/favicon|404/.test(line));
  assert.deepEqual(real, []);
});

/**
 * The kit: legend, inspector, transport.
 *
 * They exist because every demo written against this library hand-rolled them.
 * These tests hold them to the behaviour those hand-rolled versions got wrong.
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

let server, browser, page;
const consoleErrors = [];

before(async () => {
  server = http.createServer((req, res) => {
    const file = path.normalize(path.join(ROOT, decodeURIComponent(req.url.split('?')[0])));
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, resolve));

  browser = await chromium.launch(process.env.LD_CHROMIUM ? { executablePath: process.env.LD_CHROMIUM } : {});
  page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e.message)));
  await page.goto(`http://127.0.0.1:${server.address().port}/test/fixtures/harness.html`);
  await page.evaluate(() => window.__ready);

  await page.evaluate(async () => {
    document.getElementById('host2').innerHTML = '';
    window.d = new LiveDiagram({
      mount: '#host2',
      graph: 'flowchart LR\n build[Build] --> test[Test] --> ship([Ship])',
      theme: 'light'
    });
    await window.d.render();
    window.d.patch({ build: 'success', test: { state: 'running', badge: '2.1s' } });
    await new Promise((r) => setTimeout(r, 200));
  });
});

after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
});

// ---- legend ---------------------------------------------------------------

test('the legend lists the vocabulary with live counts', async () => {
  const items = await page.evaluate(async () => {
    window.legend = LiveDiagram.legend(window.d, { mount: document.body });
    await new Promise((r) => setTimeout(r, 50));
    return [...window.legend.el.querySelectorAll('.ld-legend__item')]
      .map((el) => `${el.getAttribute('data-ld-legend-state')}:${el.querySelector('b').textContent}`);
  });
  assert.ok(items.includes('success:1'), 'one node is successful');
  assert.ok(items.includes('running:1'));
  assert.ok(items.includes('idle:1'));
  assert.ok(items.includes('error:0'), 'unused states are still listed by default');
});

test('counts follow a patch without anyone recomputing them', async () => {
  const after = await page.evaluate(async () => {
    window.d.patch({ test: 'error', ship: 'success' });
    await new Promise((r) => setTimeout(r, 120));
    return [...window.legend.el.querySelectorAll('.ld-legend__item')]
      .map((el) => `${el.getAttribute('data-ld-legend-state')}:${el.querySelector('b').textContent}`);
  });
  assert.ok(after.includes('success:2'));
  assert.ok(after.includes('error:1'));
  assert.ok(after.includes('running:0'));
});

test('swatches take their colours from the state vocabulary', async () => {
  const swatch = await page.evaluate(() => {
    const el = window.legend.el.querySelector('[data-ld-legend-state="success"] .ld-legend__swatch');
    return { background: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderTopColor };
  });
  assert.equal(swatch.background, 'rgb(220, 252, 231)');
  assert.equal(swatch.border, 'rgb(22, 163, 74)');
});

test('hideUnused drops the states nothing is in', async () => {
  const states = await page.evaluate(async () => {
    const compact = LiveDiagram.legend(window.d, { hideUnused: true });
    const names = [...compact.el.querySelectorAll('.ld-legend__item')].map((el) => el.getAttribute('data-ld-legend-state'));
    compact.destroy();
    return names;
  });
  assert.deepEqual(states.sort(), ['error', 'success']);
});

test('destroying the legend unsubscribes it', async () => {
  const survived = await page.evaluate(async () => {
    const temporary = LiveDiagram.legend(window.d, { mount: document.body });
    const el = temporary.el;
    temporary.destroy();
    window.d.patch({ ship: 'error' });
    await new Promise((r) => setTimeout(r, 120));
    return { attached: !!el.parentNode, listeners: window.d._handlers.get('change').size };
  });
  assert.equal(survived.attached, false);
  assert.equal(survived.listeners, 1, 'only the surviving legend is still listening');
});

// ---- inspector ------------------------------------------------------------

test('the panel starts empty and fills in on a click', async () => {
  const result = await page.evaluate(async () => {
    window.panel = LiveDiagram.inspector(window.d, { mount: document.body, empty: 'Nothing yet.' });
    const before = window.panel.el.textContent;
    document.querySelector('#host2 [data-ld-node="build"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
    return { before, after: window.panel.el.textContent };
  });
  assert.match(result.before, /Nothing yet/);
  assert.match(result.after, /Build/);
  assert.match(result.after, /success/);
});

test('it inspects edges as well as nodes', async () => {
  const text = await page.evaluate(async () => {
    document.querySelector('#host2 [data-ld-edge="build->test"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
    return window.panel.el.textContent;
  });
  assert.match(text, /build → test/);
});

test('a template replaces the default rather than fighting it', async () => {
  const text = await page.evaluate(async () => {
    const custom = LiveDiagram.inspector(window.d, {
      mount: document.body,
      template: (p) => `<dt>id</dt><dd>${p.id.toUpperCase()}</dd>`
    });
    document.querySelector('#host2 [data-ld-node="ship"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
    const out = custom.el.textContent;
    custom.destroy();
    return out;
  });
  assert.equal(text, 'idSHIP');
});

test('the tooltip appears on hover, inside the diagram, and hides on leave', async () => {
  const shown = await page.evaluate(async () => {
    window.tip = LiveDiagram.inspector(window.d, { mode: 'tooltip' });
    const node = document.querySelector('#host2 [data-ld-node="test"]');
    node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    const el = window.tip.el;
    const base = window.d.root.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const inside = rect.left >= base.left - 1 && rect.right <= base.right + 1;
    const text = el.textContent;
    document.querySelector('#host2 .ld-canvas').dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    return {
      text, inside, hiddenAfter: el.hidden,
      // `hidden` alone is not enough: the class sets `display: grid`, which
      // outranks the browser's [hidden] rule unless the stylesheet says so.
      displayAfter: getComputedStyle(el).display,
      insideDiagram: window.d.root.contains(el)
    };
  });
  assert.match(shown.text, /Test/);
  assert.equal(shown.inside, true, 'the tooltip is clamped to the diagram');
  assert.equal(shown.insideDiagram, true);
  assert.equal(shown.hiddenAfter, true);
  assert.equal(shown.displayAfter, 'none', 'and it is actually invisible');
});

test('a tooltip is invisible before it has ever been shown', async () => {
  const display = await page.evaluate(() => {
    const tip = LiveDiagram.inspector(window.d, { mode: 'tooltip' });
    const out = getComputedStyle(tip.el).display;
    tip.destroy();
    return out;
  });
  assert.equal(display, 'none');
});

// ---- transport ------------------------------------------------------------

test('the transport reflects and drives the timeline', async () => {
  const result = await page.evaluate(async () => {
    window.tl = window.d.timeline([
      { t: 0, node: 'build', state: 'running' },
      { t: 1000, node: 'build', state: 'success' },
      { t: 2000, node: 'test', state: 'error' }
    ]);
    window.tp = LiveDiagram.transport(window.d, window.tl, { mount: document.body, speed: 5 });
    const el = window.tp.el;
    const scrub = el.querySelector('.ld-transport__scrub');
    const initial = { max: scrub.max, clock: el.querySelector('.ld-transport__clock').textContent };

    el.querySelectorAll('.ld-transport__button')[1].click();   // step
    await new Promise((r) => setTimeout(r, 60));
    const afterStep = { index: window.tl.index, clock: el.querySelector('.ld-transport__clock').textContent };

    scrub.value = '2000';
    scrub.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    const afterScrub = { position: window.tl.position, states: window.d.snapshot().states };

    return { initial, afterStep, afterScrub };
  });
  assert.equal(result.initial.max, '2000');
  assert.match(result.initial.clock, /0\.0s \/ 2\.0s/);
  assert.equal(result.afterStep.index, 1, 'step advances exactly one event');
  assert.equal(result.afterScrub.position, 2000);
  assert.equal(result.afterScrub.states.test, 'error', 'scrubbing applied the events');
});

test('play toggles, and scrubbing while playing stops the clock fighting the slider', async () => {
  const result = await page.evaluate(async () => {
    const el = window.tp.el;
    const play = el.querySelector('.ld-transport__button');
    window.tl.reset();
    play.click();
    const playing = { flag: window.tl.playing, label: play.textContent };
    const scrub = el.querySelector('.ld-transport__scrub');
    scrub.value = '500';
    scrub.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    return { playing, afterScrub: { flag: window.tl.playing, label: play.textContent } };
  });
  assert.equal(result.playing.flag, true);
  assert.equal(result.playing.label, '⏸');
  assert.equal(result.afterScrub.flag, false, 'scrubbing pauses');
  assert.equal(result.afterScrub.label, '▶');
});

test('destroying the transport stops playback and detaches', async () => {
  const after = await page.evaluate(() => {
    const el = window.tp.el;
    window.tl.play({ speed: 1 });
    window.tp.destroy();
    return { playing: window.tl.playing, attached: !!el.parentNode };
  });
  assert.deepEqual(after, { playing: false, attached: false });
});

test('the kit logged nothing to the console', () => {
  assert.deepEqual(consoleErrors.filter((l) => !/favicon|404|valid JSON/.test(l)), []);
});

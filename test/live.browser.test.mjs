/**
 * Connection handling and node overlays — the two things that only mean
 * anything against a real document and a real clock.
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
    window.d = new LiveDiagram({ mount: '#host', graph: 'flowchart LR\n a[A] --> b[B] --> c[C]', theme: 'light' });
    await window.d.render();

    // A source we drive by hand, with the same shape a real one has.
    window.makeSource = () => {
      const handle = { emit: null, notify: null, stopped: false };
      handle.source = {
        name: 'fake',
        start(emit, notify) { handle.emit = emit; handle.notify = notify; },
        stop() { handle.stopped = true; }
      };
      return handle;
    };
  });
});

after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
});

// ---- connection -----------------------------------------------------------

test('a diagram with no source reports no connection', async () => {
  assert.equal(await page.evaluate(() => window.d.connection), 'none');
});

test('attaching a source makes it live, and the root says so', async () => {
  const state = await page.evaluate(() => {
    window.h = window.makeSource();
    window.detach = window.d.connect(window.h.source);
    return { connection: window.d.connection, attr: window.d.root.getAttribute('data-ld-connection') };
  });
  assert.deepEqual(state, { connection: 'live', attr: 'live' });
});

test('backfill is asked for the truth on connect, and a snapshot replaces state', async () => {
  const result = await page.evaluate(async () => {
    const events = [];
    window.d.on('connection', (e) => events.push(e));
    window.d.on('backfill', () => events.push('backfill'));
    window.d.patch({ a: 'error' });                    // stale nonsense to be replaced

    const h = window.makeSource();
    const off = window.d.connect(h.source, {
      backfill: async () => ({ states: { a: 'success', b: 'running', c: 'idle' } })
    });
    h.notify('open');
    await new Promise((r) => setTimeout(r, 60));
    const states = window.d.snapshot().states;
    off();
    return { states, events: events.map((e) => (typeof e === 'string' ? e : `open:${e.connected}:${e.reconnected}`)) };
  });
  assert.deepEqual(result.states, { a: 'success', b: 'running', c: 'idle' });
  assert.deepEqual(result.events, ['open:true:false', 'backfill']);
});

test('a backfill that returns a patch is applied as a patch', async () => {
  const states = await page.evaluate(async () => {
    window.d.clear();
    const h = window.makeSource();
    const off = window.d.connect(h.source, { backfill: async () => ({ b: 'error' }) });
    h.notify('open');
    await new Promise((r) => setTimeout(r, 60));
    const out = window.d.snapshot().states;
    off();
    return out;
  });
  assert.deepEqual(states, { a: 'idle', b: 'error', c: 'idle' }, 'only the patched node moved');
});

test('a reconnect is reported as one, and backfills again', async () => {
  const result = await page.evaluate(async () => {
    const seen = [];
    let calls = 0;
    const h = window.makeSource();
    const off = window.d.connect(h.source, { backfill: async () => { calls++; return null; } });
    window.d.on('connection', (e) => seen.push(`${e.connected}/${e.reconnected}`));
    h.notify('open');
    await new Promise((r) => setTimeout(r, 30));
    h.notify('close');
    h.notify('open');
    await new Promise((r) => setTimeout(r, 30));
    off();
    return { seen, calls };
  });
  assert.deepEqual(result.seen, ['true/false', 'false/false', 'true/true']);
  assert.equal(result.calls, 2, 'the second connection asks for the truth again');
});

test('a dropped connection shows as stale instead of pretending', async () => {
  const result = await page.evaluate(async () => {
    const h = window.makeSource();
    const off = window.d.connect(h.source);
    h.notify('open');
    const live = window.d.root.getAttribute('data-ld-connection');
    const staleEvents = [];
    window.d.on('stale', (e) => staleEvents.push(e.stale));
    h.notify('close');
    await new Promise((r) => setTimeout(r, 30));
    const stale = {
      attr: window.d.root.getAttribute('data-ld-connection'),
      opacity: getComputedStyle(window.d.canvas).opacity,
      overlayOpacity: getComputedStyle(window.d.overlayLayer).opacity,
      label: window.d.root.getAttribute('data-ld-stale-label')
    };
    h.emit({ a: 'running' });                 // fresh state ends the staleness
    const recovered = window.d.root.getAttribute('data-ld-connection');
    off();
    return { live, stale, recovered, staleEvents };
  });
  assert.equal(result.live, 'live');
  assert.equal(result.stale.attr, 'stale');
  assert.ok(Number(result.stale.opacity) < 1, 'the canvas is visibly dimmed');
  // Badges and overlays ride a layer above the canvas. Leaving them at full
  // strength over a dimmed diagram is the exact failure this feature exists to
  // prevent: a bright "4.2s" reading as current on a picture that is not.
  assert.ok(Number(result.stale.overlayOpacity) < 1, 'badges and overlays dim with it');
  assert.match(result.stale.label, /disconnected/);
  assert.equal(result.recovered, 'live');
  assert.deepEqual(result.staleEvents, [true, false]);
});

test('markStale:false leaves the appearance alone for callers who handle it themselves', async () => {
  const attr = await page.evaluate(async () => {
    const h = window.makeSource();
    const off = window.d.connect(h.source, { markStale: false });
    h.notify('open');
    h.notify('close');
    const out = window.d.root.getAttribute('data-ld-connection');
    off();
    return out;
  });
  assert.equal(attr, 'live');
});

test('staleAfter catches a source that fails silently instead of closing', async () => {
  const result = await page.evaluate(async () => {
    const h = window.makeSource();
    const off = window.d.connect(h.source, { staleAfter: 120 });
    h.notify('open');
    h.emit({ a: 'success' });
    const before = window.d.connection;
    await new Promise((r) => setTimeout(r, 200));
    const after = window.d.connection;
    h.emit({ a: 'running' });                 // an update rearms it
    const rearmed = window.d.connection;
    off();
    return { before, after, rearmed };
  });
  assert.deepEqual(result, { before: 'live', after: 'stale', rearmed: 'live' });
});

test('detaching the LAST source stops it and leaves the diagram marked stale', async () => {
  const result = await page.evaluate(() => {
    const h = window.makeSource();
    const off = window.d.connect(h.source);
    off();
    // One source still attached from an earlier test: connection is a property
    // of the diagram, not of one socket, so it stays live until all are gone.
    const withOthers = window.d.connection;
    window.detach();
    return { stopped: h.stopped, withOthers, afterAll: window.d.connection };
  });
  // Not 'none': nobody is maintaining what is on screen any more, and whether
  // that was a dropped socket or a deliberate unplug makes no difference to a
  // reader looking at old data.
  assert.deepEqual(result, { stopped: true, withOthers: 'live', afterAll: 'stale' });
});

test('a backfill that throws is reported, not swallowed, and does not break the connection', async () => {
  const result = await page.evaluate(async () => {
    const errors = [];
    const offErr = window.d.on('error', (e) => errors.push(e.source));
    const h = window.makeSource();
    const off = window.d.connect(h.source, { backfill: async () => { throw new Error('no network'); } });
    h.notify('open');
    await new Promise((r) => setTimeout(r, 60));
    const out = { errors, connection: window.d.connection };
    off(); offErr();
    return out;
  });
  assert.deepEqual(result.errors, ['backfill:fake']);
  assert.equal(result.connection, 'live');
});

// ---- overlays -------------------------------------------------------------

test('an overlay is anchored to its node and receives clicks', async () => {
  const result = await page.evaluate(async () => {
    const button = document.createElement('button');
    button.textContent = 'retry';
    button.id = 'retry-btn';
    let clicks = 0;
    button.addEventListener('click', () => { clicks++; });
    const returned = window.d.overlay('b', button, { position: 'bottom' });
    await new Promise((r) => requestAnimationFrame(r));

    const node = document.querySelector('[data-ld-node="b"]').getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    button.click();
    return {
      returnedIsElement: returned === button,
      inLayer: window.d.overlayLayer.contains(button),
      pointerEvents: getComputedStyle(button).pointerEvents,
      nearBottom: Math.abs((rect.top + rect.height / 2) - node.bottom) < 12
        && Math.abs((rect.left + rect.width / 2) - (node.left + node.width / 2)) < 12,
      clicks
    };
  });
  assert.equal(result.returnedIsElement, true, 'the element comes back so it can be updated');
  assert.equal(result.inLayer, true);
  assert.equal(result.pointerEvents, 'auto', 'the layer ignores pointers; the overlay opts back in');
  assert.equal(result.nearBottom, true);
  assert.equal(result.clicks, 1);
});

test('HTML strings are accepted, and every anchor lands where it says', async () => {
  const result = await page.evaluate(async () => {
    const positions = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];
    const node = document.querySelector('[data-ld-node="a"]').getBoundingClientRect();
    const out = [];
    for (const position of positions) {
      const el = window.d.overlay('a', `<i>${position}</i>`, { position, className: 'probe' });
      await new Promise((r) => requestAnimationFrame(r));
      const rect = el.getBoundingClientRect();
      out.push({
        position,
        html: el.innerHTML,
        classed: el.classList.contains('probe') && el.classList.contains('ld-overlay-item'),
        dx: Math.round((rect.left + rect.width / 2) - node.left),
        dy: Math.round((rect.top + rect.height / 2) - node.top),
        w: Math.round(node.width), h: Math.round(node.height)
      });
    }
    window.d.overlay('a', null);
    return out;
  });
  const byName = Object.fromEntries(result.map((r) => [r.position, r]));
  assert.equal(byName.top.html, '<i>top</i>');
  assert.equal(byName.top.classed, true);
  assert.ok(Math.abs(byName['top-left'].dx) < 6 && Math.abs(byName['top-left'].dy) < 6, 'top-left sits on the corner');
  assert.ok(Math.abs(byName.center.dx - byName.center.w / 2) < 6, 'center is centred horizontally');
  assert.ok(Math.abs(byName.center.dy - byName.center.h / 2) < 6, 'center is centred vertically');
  assert.ok(Math.abs(byName['bottom-right'].dx - byName['bottom-right'].w) < 6, 'bottom-right reaches the far edge');
  assert.ok(Math.abs(byName['bottom-right'].dy - byName['bottom-right'].h) < 6);
});

test('offset nudges an overlay off the anchor', async () => {
  const delta = await page.evaluate(async () => {
    const plain = window.d.overlay('c', '<b>x</b>', { position: 'top' });
    await new Promise((r) => requestAnimationFrame(r));
    const before = plain.getBoundingClientRect().top;
    const moved = window.d.overlay('c', '<b>x</b>', { position: 'top', offset: [0, -20] });
    await new Promise((r) => requestAnimationFrame(r));
    const after = moved.getBoundingClientRect().top;
    window.d.overlay('c', null);
    return Math.round(before - after);
  });
  assert.ok(delta >= 18 && delta <= 22, `moved up by about 20px (got ${delta})`);
});

test('an overlay survives a full re-render and follows the node', async () => {
  const result = await page.evaluate(async () => {
    const el = window.d.overlay('b', '<span>alive</span>', { position: 'top' });
    await window.d.setTheme('dark').render();
    await new Promise((r) => setTimeout(r, 250));
    const node = document.querySelector('[data-ld-node="b"]').getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const out = {
      stillThere: window.d.overlayLayer.contains(el),
      text: el.textContent,
      nearTop: Math.abs((rect.top + rect.height / 2) - node.top) < 12
    };
    await window.d.setTheme('light').render();
    return out;
  });
  assert.deepEqual(result, { stillThere: true, text: 'alive', nearTop: true });
});

test('an overlay on a node the graph no longer has is hidden, not orphaned on screen', async () => {
  const hidden = await page.evaluate(async () => {
    const el = window.d.overlay('c', '<span>gone</span>');
    await window.d.setGraph('flowchart LR\n a[A] --> b[B]').render();
    await new Promise((r) => setTimeout(r, 200));
    const display = getComputedStyle(el).display;
    await window.d.setGraph('flowchart LR\n a[A] --> b[B] --> c[C]').render();
    await new Promise((r) => setTimeout(r, 200));
    const back = getComputedStyle(el).display;
    window.d.clearOverlays();
    return { display, back };
  });
  assert.equal(hidden.display, 'none');
  assert.notEqual(hidden.back, 'none', 'and it comes back when the node does');
});

test('clearOverlays removes overlays and leaves badges alone', async () => {
  const result = await page.evaluate(async () => {
    window.d.badge('a', '42s');
    window.d.overlay('a', '<span>o</span>');
    await new Promise((r) => requestAnimationFrame(r));
    const before = { badges: document.querySelectorAll('.ld-badge').length, items: document.querySelectorAll('.ld-overlay-item').length };
    window.d.clearOverlays();
    const after = { badges: document.querySelectorAll('.ld-badge').length, items: document.querySelectorAll('.ld-overlay-item').length };
    window.d.badge('a', null);
    return { before, after };
  });
  assert.deepEqual(result.before, { badges: 1, items: 1 });
  assert.deepEqual(result.after, { badges: 1, items: 0 });
});

// ---- export ---------------------------------------------------------------

test('toSVG returns a standalone document with the diagram in it', async () => {
  const svg = await page.evaluate(() => LiveDiagram.toSVG(window.d));
  assert.match(svg, /^<\?xml version="1\.0"/);
  assert.match(svg, /<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /width="\d+"/, 'real dimensions, not a percentage');
  assert.match(svg, /height="\d+"/);
  assert.ok(svg.includes('>A<') || svg.includes('>A</'), 'the labels came along');
});

test('badges are redrawn into the SVG, since the originals are HTML', async () => {
  const result = await page.evaluate(async () => {
    window.d.badge('a', '4.2s');
    await new Promise((r) => requestAnimationFrame(r));
    const withBadges = LiveDiagram.toSVG(window.d);
    const without = LiveDiagram.toSVG(window.d, { badges: false });
    window.d.badge('a', null);
    return { withBadges, without };
  });
  assert.match(result.withBadges, /ld-export-badges/);
  assert.match(result.withBadges, />4\.2s</);
  assert.equal(result.without.includes('ld-export-badges'), false);
});

test('a background is added when asked for, and left out when not', async () => {
  const result = await page.evaluate(() => ({
    plain: LiveDiagram.toSVG(window.d),
    onWhite: LiveDiagram.toSVG(window.d, { background: '#ffffff' })
  }));
  assert.match(result.onWhite, /<rect[^>]+fill="#ffffff"/);
  assert.equal(/<rect[^>]+fill="#ffffff"[^>]*width="100%"/.test(result.plain), false);
});

test('toPNG refuses HTML labels by name instead of exporting a wordless picture', async () => {
  const message = await page.evaluate(async () => {
    try { await LiveDiagram.toPNG(window.d); return 'no error'; }
    catch (err) { return err.message; }
  });
  assert.match(message, /HTML labels/);
  assert.match(message, /svgLabels: true/, 'and it says how to fix it');
});

test('toPNG produces a real PNG when labels are drawn as SVG text', async () => {
  const result = await page.evaluate(async () => {
    const host = document.createElement('div');
    host.style.height = '300px';
    document.body.appendChild(host);
    const png = new LiveDiagram({
      mount: host,
      graph: 'flowchart LR\n one[One] --> two[Two]',
      renderer: LiveDiagram.mermaidRenderer({ svgLabels: true })
    });
    await png.render();
    png.patch({ one: 'success' });
    await new Promise((r) => setTimeout(r, 250));
    const blob = await LiveDiagram.toPNG(png, { scale: 1 });
    const header = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    png.destroy();
    host.remove();
    return { type: blob.type, size: blob.size, header: Array.from(header) };
  });
  assert.equal(result.type, 'image/png');
  assert.ok(result.size > 1000, `a real image, not an empty one (${result.size} bytes)`);
  // PNG magic number: the file really is a PNG.
  assert.deepEqual(result.header, [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('exporting before anything is rendered says so', async () => {
  const message = await page.evaluate(() => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const fresh = new LiveDiagram({ mount: host, graph: 'flowchart LR\n x --> y' });
    try { LiveDiagram.toSVG(fresh); return 'no error'; }
    catch (err) { return err.message; }
    finally { fresh.destroy(); host.remove(); }
  });
  assert.match(message, /nothing rendered yet/);
});

test('a share link round-trips the graph and the state into another diagram', async () => {
  const result = await page.evaluate(async () => {
    window.d.patch({ a: 'success', b: 'error', 'a->b': 'error' });
    window.d.badge('a', '1.0s');
    const url = LiveDiagram.shareUrl(window.d, { graph: 'flowchart LR\n a[A] --> b[B] --> c[C]', url: 'https://example.com/page' });

    const host = document.createElement('div');
    host.style.height = '300px';
    document.body.appendChild(host);
    const other = new LiveDiagram({ mount: host, graph: 'flowchart LR\n z[Z]' });
    await other.render();
    const applied = LiveDiagram.applyShared(other, url.split('#')[1]);
    await new Promise((r) => setTimeout(r, 250));
    const out = {
      url: url.split('#')[0],
      applied,
      states: other.snapshot().states,
      edge: other.getEdge('a->b').state,
      badge: other.get('a').badge,
      rendered: host.querySelectorAll('[data-ld-node]').length
    };
    other.destroy(); host.remove();
    window.d.badge('a', null);
    return out;
  });
  assert.equal(result.url, 'https://example.com/page');
  assert.equal(result.applied, true);
  assert.deepEqual(result.states, { a: 'success', b: 'error', c: 'idle' });
  assert.equal(result.edge, 'error');
  assert.equal(result.badge, '1.0s');
  assert.equal(result.rendered, 3, 'the shared graph replaced the old one');
});

test('applyShared ignores a link it cannot read', async () => {
  assert.equal(await page.evaluate(() => LiveDiagram.applyShared(window.d, '#garbage!!')), false);
});

test('nothing unexpected reached the console', () => {
  assert.deepEqual(consoleErrors.filter((l) => !/favicon|404/.test(l)), []);
});

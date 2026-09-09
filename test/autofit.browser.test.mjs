/**
 * autoFit 'observe' — the ResizeObserver contract: keep the diagram fitted as
 * its container resizes, yield permanently to the first user zoom, tear down
 * with the diagram, and never loop.
 *
 * Red-first evidence (archived pre-implementation, observed 3/6 red): the
 * 'refits', rerender and 'settles' tests all fail for the same reason — no
 * observer exists, so a resize after the initial fit changes nothing. The
 * user-zoom, default-mode and destroy tests are green pre-implementation by
 * vacuity (no observer exists to misbehave); they pin the behavior once it
 * does. Resize fixtures deliberately drop the expected fit BELOW the 1.75
 * cap — a resize where expected equals the current scale cannot tell a
 * refit from a no-op.
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
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e.message)));
  await page.goto(`http://127.0.0.1:${server.address().port}/test/fixtures/harness.html`);
  await page.evaluate(() => window.__ready);

  await page.evaluate(() => {
    window.TINY = 'flowchart LR\n a[A] --> b[B]';

    window.mk = async (w, h, opts) => {
      if (window.d) { try { window.d.destroy(); } catch (e) {} }
      if (window.mount) window.mount.remove();
      window.mount = document.createElement('div');
      window.mount.style.cssText = `width:${w}px;height:${h}px`;
      document.body.appendChild(window.mount);
      window.d = new LiveDiagram(Object.assign({ mount: window.mount, theme: 'light' }, opts));
      await window.d.render();
      return window.geo();
    };

    window.geo = () => {
      // Bare mode has no .ld-viewport — the root is the scroller.
      const vp = window.mount.querySelector('.ld-viewport') || window.mount.querySelector('.ld');
      const svg = window.mount.querySelector('.ld-canvas svg');
      return {
        scale: window.d.viewport.scale,
        vb: { w: svg.viewBox.baseVal.width, h: svg.viewBox.baseVal.height },
        client: { w: vp.clientWidth, h: vp.clientHeight }
      };
    };

    window.expectedFit = (g) => Math.min((g.client.w - 24) / g.vb.w, (g.client.h - 24) / g.vb.h, 1.75);

    window.resizeTo = (w, h) => { window.mount.style.width = `${w}px`; window.mount.style.height = `${h}px`; };

    window.waitFor = (pred, timeout) => new Promise((resolve) => {
      const t0 = performance.now();
      const poll = () => {
        if (pred()) return resolve(true);
        if (performance.now() - t0 > (timeout || 2000)) return resolve(false);
        setTimeout(poll, 40);
      };
      poll();
    });

    window.chipError = (nodeId) => {
      const chip = window.mount.querySelector(`[data-ld-badge-for="${nodeId}"]`);
      const n = window.d._nodes.get(nodeId).getBoundingClientRect();
      const c = chip.getBoundingClientRect();
      return {
        dx: Math.abs((c.left + c.width / 2) - (n.right - 6)),
        dy: Math.abs((c.top + c.height / 2) - (n.top - 6))
      };
    };
  });
});

after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
  assert.deepEqual(consoleErrors, [], 'no console errors leaked');
});

test('observe mode refits when the container resizes', async () => {
  const r = await page.evaluate(async () => {
    const g0 = await window.mk(900, 600, { graph: window.TINY, autoFit: 'observe' });
    // Small enough that the expected fit drops BELOW the 1.75 cap — a resize
    // where expected == initial cannot tell a refit from a no-op.
    window.resizeTo(220, 140);
    const refitted = await window.waitFor(() => {
      const g = window.geo();
      return Math.abs(g.scale - window.expectedFit(g)) <= 0.01 && g.scale !== g0.scale;
    });
    const g1 = window.geo();
    return { initial: g0.scale, refitted, scale: g1.scale, expected: window.expectedFit(g1) };
  });
  assert.ok(Math.abs(r.initial - 1.75) <= 0.01, `starts fitted at the cap (got ${r.initial})`);
  assert.ok(r.refitted, `resize must refit: scale ${r.scale}, expected ${r.expected}`);
});

test('a user zoom permanently cancels observation', async () => {
  const r = await page.evaluate(async () => {
    await window.mk(900, 600, { graph: window.TINY, autoFit: 'observe' });
    window.d.zoomIn();
    const afterZoom = window.geo().scale;
    window.resizeTo(400, 260);
    // Give a would-be refit ample time past any debounce.
    await new Promise((r2) => setTimeout(r2, 600));
    return { afterZoom, final: window.geo().scale };
  });
  assert.equal(r.final, r.afterZoom, 'no refit after the user has zoomed');
});

test('default autoFit fits once and ignores resizes', async () => {
  const r = await page.evaluate(async () => {
    const g0 = await window.mk(900, 600, { graph: window.TINY });
    window.resizeTo(300, 200);
    await new Promise((r2) => setTimeout(r2, 600));
    return { initial: g0.scale, final: window.geo().scale };
  });
  assert.equal(r.final, r.initial, 'fit-once must not react to resize');
});

test('destroy disconnects the observer', async () => {
  const ok = await page.evaluate(async () => {
    await window.mk(900, 600, { graph: window.TINY, autoFit: 'observe' });
    window.d.destroy();
    window.resizeTo(500, 300);
    await new Promise((r2) => setTimeout(r2, 600));
    return true; // errors would land in the console-error trap
  });
  assert.ok(ok);
});

test('observation survives a rerender, and the refit heals badges', async () => {
  const r = await page.evaluate(async () => {
    await window.mk(900, 600, { graph: window.TINY, autoFit: 'observe' });
    window.d.patch({ a: { state: 'running', badge: '9s' } });
    window.d.setTheme('dark');
    await window.d.render();
    window.resizeTo(220, 140);
    const refitted = await window.waitFor(() => {
      const g = window.geo();
      return Math.abs(g.scale - window.expectedFit(g)) <= 0.01 && g.scale < 1.74;
    });
    await new Promise((r2) => setTimeout(r2, 100));
    return { refitted, scale: window.geo().scale, expected: window.expectedFit(window.geo()), chip: window.chipError('a') };
  });
  assert.ok(r.refitted, `resize after setTheme must still refit (scale ${r.scale}, expected ${r.expected})`);
  assert.ok(r.chip.dx <= 3 && r.chip.dy <= 3,
    `the refit heals badge anchors (off by ${r.chip.dx},${r.chip.dy}) — a silent fit() leaves them stale`);
});

test('observation survives hide and reshow — a collapsed container is not a hand zoom', async () => {
  const r = await page.evaluate(async () => {
    const g0 = await window.mk(900, 600, { graph: window.TINY, autoFit: 'observe' });
    window.mount.style.display = 'none';
    await new Promise((r2) => setTimeout(r2, 400));
    const hidden = window.d.viewport.scale;
    window.mount.style.display = '';
    window.resizeTo(220, 140);
    const refitted = await window.waitFor(() => {
      const g = window.geo();
      return Math.abs(g.scale - window.expectedFit(g)) <= 0.01 && g.scale !== g0.scale;
    });
    return { initial: g0.scale, hidden, refitted, final: window.geo().scale };
  });
  assert.equal(r.hidden, r.initial, 'hiding must not snap the scale to 1');
  assert.ok(r.refitted, `observation must survive hide/reshow (final scale ${r.final})`);
});

test('bare mode never arms the observer — its scroller is the content-sized root', async () => {
  const r = await page.evaluate(async () => {
    await window.mk(600, 400, { graph: window.TINY, autoFit: 'observe', viewport: false });
    const initial = window.d.viewport.scale;
    window.mount.style.width = '300px';
    await new Promise((r2) => setTimeout(r2, 600));
    return { initial, final: window.d.viewport.scale };
  });
  assert.equal(r.final, r.initial, 'no refit ratchet in bare mode');
});

test('the scale settles after one resize — no observer feedback loop', async () => {
  const r = await page.evaluate(async () => {
    await window.mk(900, 600, { graph: window.TINY, autoFit: 'observe' });
    window.resizeTo(220, 120);
    const reached = await window.waitFor(() => {
      const g = window.geo();
      return g.scale < 1.74 && Math.abs(g.scale - window.expectedFit(g)) <= 0.01;
    });
    const settled = window.geo().scale;
    const samples = [];
    for (let i = 0; i < 10; i++) {
      await new Promise((r2) => setTimeout(r2, 50));
      samples.push(window.geo().scale);
    }
    return { reached, settled, samples };
  });
  assert.ok(r.reached, 'reaches the expected fit');
  assert.ok(r.samples.every((s) => s === r.settled),
    `scale must stay put once fitted (saw ${[...new Set(r.samples)].join(', ')})`);
});

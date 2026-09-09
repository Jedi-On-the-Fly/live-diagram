/**
 * Fit and zoom geometry — the invariant under test is that the layout box IS
 * the visual box, at every scale, through every path that changes scale.
 *
 * Red-first evidence (run against the pre-fix dist, archived by the build
 * process): 'fallback' (canvas box 300px for a ~117px diagram), 'symmetric'
 * (rect = offset × scale under the old transform, gaps 237/143), 'phantom'
 * (scrollHeight 2054 for 609px of content), 'interactive' (extents track the
 * stale layout box), plus fit-scale equality (525px visual vs ~205 expected),
 * fit-below-min (clamped to 0.3), the rerender g3 sub-check (below-min scale
 * cannot exist pre-fix) and 'export' (width attribute inherits the 300px
 * fallback box: 300, not the viewBox's ~117). Observed pre-fix run: 8/8 red,
 * all ERR_ASSERTION on the intended clauses (fallback 300 vs 117.34; visual
 * 524.9 vs layout 300; scale 0.3 vs expected 0.1205; scrollHeight 7060 vs 260;
 * export width 300 vs 117). The rerender sub-checks split: scale persistence
 * (g1's getter half) and the badge anchor (g2) are green pre-fix because the
 * old transform lived on .ld-canvas, which re-renders never replace — they
 * guard the redesign — while g1's natural-size half and g3 are red pre-fix
 * because the fallback box and the min clamp predate it.
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
    const chain = { direction: 'TB', nodes: {}, edges: [] };
    for (let i = 0; i < 24; i++) {
      chain.nodes['n' + i] = { label: 'step ' + i };
      if (i) chain.edges.push({ from: 'n' + (i - 1), to: 'n' + i });
    }
    window.TALL = chain;

    // A fresh, sized mount per test; the previous one is torn down first.
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
      const vp = window.mount.querySelector('.ld-viewport');
      const canvas = window.mount.querySelector('.ld-canvas');
      const svg = canvas.querySelector('svg');
      const vr = vp.getBoundingClientRect();
      const cr = canvas.getBoundingClientRect();
      return {
        scale: window.d.viewport.scale,
        vb: { w: svg.viewBox.baseVal.width, h: svg.viewBox.baseVal.height },
        layout: { w: canvas.offsetWidth, h: canvas.offsetHeight },
        visual: { w: cr.width, h: cr.height },
        gaps: { top: cr.top - vr.top, bottom: vr.bottom - cr.bottom, left: cr.left - vr.left, right: vr.right - cr.right },
        client: { w: vp.clientWidth, h: vp.clientHeight },
        scroll: { w: vp.scrollWidth, h: vp.scrollHeight }
      };
    };

    // fit()'s contract: 24px of breathing room (the viewport's 12px padding,
    // both sides), capped at maxFitScale.
    window.expectedFit = (g) => Math.min((g.client.w - 24) / g.vb.w, (g.client.h - 24) / g.vb.h, 1.75);

    window.settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    // The .ld-badge anchor contract: the chip is CSS-centered over the point
    // (nodeRect.right - 6, nodeRect.top - 6).
    window.chipError = (nodeId) => {
      const chip = window.mount.querySelector(`[data-ld-badge-for="${nodeId}"]`);
      const node = window.mount.querySelector(`[data-ld-node="${nodeId}"]`) ||
                   window.d._nodes.get(nodeId);
      const c = chip.getBoundingClientRect();
      const n = (node.getBoundingClientRect ? node : window.d._nodes.get(nodeId)).getBoundingClientRect();
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

test('a small diagram gets its natural layout box, not the 300px replaced-element fallback', async () => {
  const g = await page.evaluate(() => window.mk(900, 600, { graph: window.TINY, autoFit: false }));
  assert.ok(g.vb.w < 300, `fixture must be narrower than the fallback (got ${g.vb.w})`);
  assert.ok(Math.abs(g.layout.w - g.vb.w) <= 2,
    `layout box ${g.layout.w} should equal viewBox width ${g.vb.w}, not the CSS fallback`);
});

test('fit leaves the layout box equal to the visual box, centered with symmetric gaps', async () => {
  const g = await page.evaluate(() => window.mk(900, 600, { graph: window.TINY }));
  assert.ok(Math.abs(g.visual.w - g.layout.w) <= 1, `visual ${g.visual.w} == layout ${g.layout.w}`);
  assert.ok(Math.abs(g.visual.h - g.layout.h) <= 1, `visual ${g.visual.h} == layout ${g.layout.h}`);
  assert.ok(Math.abs(g.gaps.top - g.gaps.bottom) <= 2, `top ${g.gaps.top} vs bottom ${g.gaps.bottom}`);
  assert.ok(Math.abs(g.gaps.left - g.gaps.right) <= 2, `left ${g.gaps.left} vs right ${g.gaps.right}`);
});

test('fit reaches exactly its expected scale — the cap counts natural size, not a fallback box', async () => {
  const g = await page.evaluate(() => window.mk(900, 600, { graph: window.TINY }));
  const expected = Math.min((g.client.w - 24) / g.vb.w, (g.client.h - 24) / g.vb.h, 1.75);
  assert.ok(Math.abs(g.scale - expected) <= 0.01, `scale ${g.scale} == expected ${expected}`);
  assert.ok(Math.abs(g.visual.w - g.vb.w * expected) <= 2,
    `visual ${g.visual.w} == natural ${g.vb.w} x ${expected}`);
});

test('fit goes below the interactive min when the diagram demands it', async () => {
  const g = await page.evaluate(() => window.mk(900, 260, { graph: window.TALL }));
  const expected = Math.min((g.client.w - 24) / g.vb.w, (g.client.h - 24) / g.vb.h, 1.75);
  assert.ok(expected < 0.3, `fixture must demand a below-min scale (expected ${expected})`);
  assert.ok(Math.abs(g.scale - expected) <= 0.005, `scale ${g.scale} == expected ${expected}`);
  assert.ok(g.visual.h <= g.client.h + 1, `visual ${g.visual.h} fits ${g.client.h}`);
  assert.ok(g.visual.w <= g.client.w + 1, `visual ${g.visual.w} fits ${g.client.w}`);
});

test('no phantom scroll: extents match the content after fit and after zoomOut', async () => {
  let g = await page.evaluate(() => window.mk(900, 260, { graph: window.TALL }));
  assert.ok(Math.abs(g.scroll.h - g.client.h) <= 1,
    `fitted content must not leave scroll space: scrollHeight ${g.scroll.h} vs client ${g.client.h}`);
  assert.ok(Math.abs(g.scroll.w - g.client.w) <= 1,
    `scrollWidth ${g.scroll.w} vs client ${g.client.w}`);
  g = await page.evaluate(async () => { window.d.zoomOut(); await window.settle(); return window.geo(); });
  for (const axis of ['w', 'h']) {
    const expected = g.visual[axis] + 24 > g.client[axis] ? g.visual[axis] + 24 : g.client[axis];
    assert.ok(Math.abs(g.scroll[axis] - expected) <= 2,
      `after zoomOut, scroll ${axis} ${g.scroll[axis]} should be ${expected} (visual ${g.visual[axis]})`);
  }
});

test('interactive zoom keeps rect==offset and honest scroll extents in both directions', async () => {
  await page.evaluate(() => window.mk(900, 260, { graph: window.TALL }));
  for (const step of ['zoomIn', 'zoomIn', 'zoomOut']) {
    const g = await page.evaluate(async (s) => { window.d[s](); await window.settle(); return window.geo(); }, step);
    assert.ok(Math.abs(g.visual.w - g.layout.w) <= 1, `${step}: visual ${g.visual.w} == layout ${g.layout.w}`);
    assert.ok(Math.abs(g.visual.h - g.layout.h) <= 1, `${step}: visual ${g.visual.h} == layout ${g.layout.h}`);
    for (const axis of ['w', 'h']) {
      const expected = g.visual[axis] + 24 > g.client[axis] ? g.visual[axis] + 24 : g.client[axis];
      assert.ok(Math.abs(g.scroll[axis] - expected) <= 2,
        `${step}: scroll ${axis} ${g.scroll[axis]} should be ${expected} (visual ${g.visual[axis]})`);
    }
  }
});

test('zoom survives rerender: scale, visual box, badge anchors and below-min scales persist', async () => {
  // g1: the svg is replaced wholesale on a full render; the scale must be
  // reprojected onto the new one, visually and in the getter.
  let r = await page.evaluate(async () => {
    await window.mk(900, 600, { graph: window.TINY });
    window.d.patch({ a: { state: 'running', badge: '9s' } });
    await window.settle();
    const before = window.geo();
    window.d.setTheme('dark');
    await window.d.render();
    await window.settle();
    return { before, after: window.geo(), chip: window.chipError('a') };
  });
  assert.ok(Math.abs(r.before.scale - 1.75) <= 0.01, `fixture fits at the cap (got ${r.before.scale})`);
  assert.ok(Math.abs(r.after.scale - 1.75) <= 0.01, `scale survives rerender (got ${r.after.scale})`);
  assert.ok(Math.abs(r.after.visual.w - r.after.vb.w * 1.75) <= 3,
    `visual ${r.after.visual.w} still natural ${r.after.vb.w} x 1.75 after rerender`);
  // g2: overlays are synced against the reprojected geometry, so the badge
  // chip still honours its anchor contract.
  assert.ok(r.chip.dx <= 3 && r.chip.dy <= 3,
    `badge chip anchored after rerender (off by ${r.chip.dx},${r.chip.dy})`);
  // g3: a below-min fit scale is a projection, not a zoom request — a
  // re-render must not clamp it back up to min.
  r = await page.evaluate(async () => {
    const g = await window.mk(900, 260, { graph: window.TALL });
    window.d.setTheme('dark');
    await window.d.render();
    await window.settle();
    return { expected: window.expectedFit(g), after: window.geo() };
  });
  assert.ok(r.expected < 0.3, `fixture demands below-min (expected ${r.expected})`);
  assert.ok(Math.abs(r.after.scale - r.expected) <= 0.01,
    `below-min scale survives rerender: ${r.after.scale} vs ${r.expected}`);
  assert.ok(r.after.visual.h <= r.after.client.h + 1, 'still fits after rerender');
});

test('export stays clean of the zoom projection', async () => {
  const r = await page.evaluate(async () => {
    const g = await window.mk(900, 600, { graph: window.TINY });
    const markup = LiveDiagram.toSVG(window.d);
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
    const root = doc.documentElement;
    return {
      scale: g.scale,
      vbW: g.vb.w,
      widthAttr: Number(root.getAttribute('width')),
      styleWidth: (root.getAttribute('style') || '').match(/(?:^|[^-])width\s*:/) ? root.style.width : ''
    };
  });
  assert.ok(Math.abs(r.scale - 1.75) <= 0.01, `fixture fits at the cap (got ${r.scale})`);
  assert.equal(r.styleWidth, '', 'no inline width style leaks from the zoom projection');
  assert.ok(Math.abs(r.widthAttr - Math.round(r.vbW)) <= 2,
    `export width ${r.widthAttr} equals the natural viewBox width ${Math.round(r.vbW)}`);
});

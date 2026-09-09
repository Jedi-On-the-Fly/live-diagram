/**
 * The DOM and theming contract — the structure and tokens the README promises.
 *
 * Red-first evidence (archived pre-implementation): the 'ld-bg' test fails
 * because .ld does not yet consume the token (computed background stays
 * transparent whatever the host sets). The default-transparency and structure
 * tests are green before and after — they pin what must NOT change.
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
    window.mk = async (opts, hostStyle) => {
      if (window.d) { try { window.d.destroy(); } catch (e) {} }
      if (window.mount) window.mount.remove();
      window.mount = document.createElement('div');
      window.mount.style.cssText = `width:600px;height:400px;${hostStyle || ''}`;
      document.body.appendChild(window.mount);
      window.d = new LiveDiagram(Object.assign({
        mount: window.mount, theme: 'light', graph: 'flowchart LR\n a[A] --> b[B]'
      }, opts));
      await window.d.render();
    };
  });
});

after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
  assert.deepEqual(consoleErrors, [], 'no console errors leaked');
});

test('--ld-bg set on a host ancestor paints the diagram surface', async () => {
  const bg = await page.evaluate(async () => {
    await window.mk({}, '--ld-bg: rgb(11, 22, 33)');
    return getComputedStyle(window.mount.querySelector('.ld')).backgroundColor;
  });
  assert.equal(bg, 'rgb(11, 22, 33)', 'the .ld surface must consume --ld-bg');
});

test('without --ld-bg the surface stays transparent — the default must not change', async () => {
  const bg = await page.evaluate(async () => {
    await window.mk({});
    return getComputedStyle(window.mount.querySelector('.ld')).backgroundColor;
  });
  assert.equal(bg, 'rgba(0, 0, 0, 0)');
});

test('a mounted diagram exposes the documented structure', async () => {
  const r = await page.evaluate(async () => {
    await window.mk({});
    const ld = window.mount.querySelector('.ld');
    const vp = ld && ld.querySelector(':scope > .ld-viewport');
    const canvas = vp && vp.querySelector(':scope > .ld-canvas');
    const svg = canvas && canvas.querySelector(':scope > svg');
    const overlay = vp && vp.querySelector(':scope > .ld-overlay');
    return { ld: !!ld, vp: !!vp, canvas: !!canvas, svg: !!svg, overlay: !!overlay };
  });
  assert.deepEqual(r, { ld: true, vp: true, canvas: true, svg: true, overlay: true },
    'the contract is .ld > .ld-viewport > (.ld-canvas > svg) + .ld-overlay');
});

/**
 * Demo smoke: every shipped page loads clean, and the Theme button actually
 * reaches the diagram instance.
 *
 * Exists because of one bug: boot.js reached for `window.diagram`, but three
 * demos deliberately store their instance as `window.chart` (the
 * `id="diagram"` element-global trap the docs warn about), so their Theme
 * button threw and left the diagram in the old theme while the page flipped —
 * the exact half-themed state the README tells adopters cannot happen.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json' };

let server, browser, base;

before(async () => {
  server = http.createServer((req, res) => {
    const file = path.normalize(path.join(ROOT, decodeURIComponent(req.url.split('?')[0])));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.LD_CHROMIUM ? { executablePath: process.env.LD_CHROMIUM } : {});
});

after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
});

const PAGES = [
  '/demo/index.html',
  '/demo/pipeline.html',
  '/demo/github-actions.html',
  '/demo/state-machine.html',
  '/demo/replay.html',
  '/demo/infra.html',
  '/demo/playground.html',
  '/starter.html'
];

for (const url of PAGES) {
  test(`${url} loads clean and its Theme button themes the diagram`, async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e.message)));
    try {
      await page.goto(base + url, { waitUntil: 'load' });
      // Let boot.js fetch the bundle and Mermaid draw.
      await page.waitForTimeout(1800);

      const themeButton = page.locator('button:has-text("Theme")');
      if (await themeButton.count()) {
        await themeButton.first().click();
        await page.waitForTimeout(900);
        const state = await page.evaluate(() => {
          const ld = document.querySelector('.ld');
          return {
            html: document.documentElement.getAttribute('data-theme'),
            diagram: ld ? ld.getAttribute('data-theme') : null
          };
        });
        if (state.diagram !== null) {
          assert.equal(state.diagram, state.html,
            'the diagram must follow the page theme — a mismatch means setTheme never reached the instance');
        }
      }
      assert.deepEqual(errors, [], 'no console errors');
    } finally {
      await page.close();
    }
  });
}

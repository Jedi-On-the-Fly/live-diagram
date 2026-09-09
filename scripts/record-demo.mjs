#!/usr/bin/env node
/**
 * Records docs/media/pipeline.gif from the CI demo — the README's first
 * impression, reproducible instead of hand-made.
 *
 *   npm run demo &            # serve the repo
 *   node scripts/record-demo.mjs
 *
 * Needs ffmpeg on PATH. Set LD_CHROMIUM to use a specific Chromium.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = process.env.LD_DEMO_URL || 'http://localhost:8080/demo/pipeline.html';
const OUT = path.join(ROOT, 'docs', 'media', 'pipeline.gif');
const FPS = 6;
const SECONDS = 9.5;

const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-frames-'));
const browser = await chromium.launch(process.env.LD_CHROMIUM ? { executablePath: process.env.LD_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1120, height: 640 }, deviceScaleFactor: 1 });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-ld-node]');
await page.waitForTimeout(400);

const stage = await page.$('.stage');
const box = await stage.boundingBox();
const clip = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };

await page.click('#run');
const total = Math.round(FPS * SECONDS);
for (let i = 0; i < total; i++) {
  await page.screenshot({ path: path.join(frames, `f${String(i).padStart(3, '0')}.png`), clip });
  await page.waitForTimeout(1000 / FPS);
}
await browser.close();

fs.mkdirSync(path.dirname(OUT), { recursive: true });
execFileSync('ffmpeg', [
  '-y', '-framerate', String(FPS), '-i', path.join(frames, 'f%03d.png'),
  '-vf', `fps=${FPS},scale=880:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3`,
  '-loop', '0', OUT
], { stdio: 'ignore' });

fs.rmSync(frames, { recursive: true, force: true });
console.log(`${path.relative(ROOT, OUT)} — ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);

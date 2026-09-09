/**
 * Docs-vs-styles drift: the README's "The DOM contract" section names classes
 * and custom properties; this suite holds those names to src/styles.js and the
 * documented option values to the source that implements them — in both
 * directions for the core custom properties, so a token added to the CSS
 * without documentation fails just like a documented typo does.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSS } from '../src/styles.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const readme = read('README.md');
const section = (() => {
  const m = readme.match(/## The DOM contract\n([\s\S]*?)\n## /);
  assert.ok(m, 'README must keep a "The DOM contract" section');
  return m[1];
})();

test('every .ld-* class the contract section names exists in the stylesheet', () => {
  const documented = new Set(section.match(/\.ld(?:-[a-z-]+)?\b/g));
  assert.ok(documented.size >= 5, `expected the structure tree, found ${[...documented].join(', ')}`);
  for (const cls of documented) {
    assert.ok(CSS.includes(cls), `README documents ${cls} but src/styles.js has no such class`);
  }
});

test('custom properties agree in both directions (core stylesheet vs contract section)', () => {
  const documented = new Set(section.match(/--ld-[a-z-]+/g));
  const coreCss = CSS.split('── kit ──')[0];
  const inCss = new Set(coreCss.match(/--ld-[a-z-]+/g));
  for (const prop of documented) {
    assert.ok(inCss.has(prop), `README documents ${prop} but the core stylesheet never mentions it`);
  }
  for (const prop of inCss) {
    assert.ok(documented.has(prop), `${prop} exists in the core stylesheet but the contract section does not document it`);
  }
});

test('--ld-bg is consumed with a transparent fallback — the default must not change', () => {
  assert.match(CSS, /var\(--ld-bg,\s*transparent\)/);
});

test("the documented autoFit 'observe' value exists where the docs say it does", () => {
  assert.ok(readme.includes("'observe'"), 'README documents the observe mode');
  assert.ok(read('llms.txt').includes("fit=\"observe\""), 'llms.txt documents the element attribute');
  assert.ok(read('src/live-diagram.js').includes("'observe'"), 'the class implements observe');
  assert.ok(read('src/element.js').includes("'observe'"), 'the element wires fit="observe"');
});

test('the contract stays transform-free — the README promise is checked, not remembered', () => {
  assert.ok(section.includes('never assume a transform'), 'README states the no-transform rule');
  assert.ok(!read('src/viewport.js').includes('transformOrigin'),
    'viewport must not reintroduce a transform-based zoom');
});

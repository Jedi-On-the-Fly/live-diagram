import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as src from '../src/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

test('the build runs and emits all three artifacts', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build.js')], { cwd: ROOT });
  for (const file of ['live-diagram.umd.js', 'live-diagram.cjs', 'live-diagram.esm.js']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'dist', file)), `${file} exists`);
  }
});

test('the UMD bundle exports exactly what src/index.js does', () => {
  const bundled = require(path.join(ROOT, 'dist', 'live-diagram.cjs'));
  const expected = Object.keys(src).filter((k) => k !== 'default').sort();
  const actual = Object.keys(bundled).filter((k) => k !== '__esModule').sort();
  assert.deepEqual(actual, expected);
});

test('the class doubles as the namespace for <script> tag users', () => {
  const bundled = require(path.join(ROOT, 'dist', 'live-diagram.cjs'));
  assert.equal(typeof bundled.LiveDiagram.mermaidRenderer, 'function');
  assert.equal(bundled.LiveDiagram.VERSION, src.VERSION);
});

test('no import/export statement survives into the UMD bundle', () => {
  const code = fs.readFileSync(path.join(ROOT, 'dist', 'live-diagram.umd.js'), 'utf8');
  assert.equal(/^\s*(import|export)\s/m.test(code), false);
});

test('the bundle is dependency-free', () => {
  const code = fs.readFileSync(path.join(ROOT, 'dist', 'live-diagram.umd.js'), 'utf8');
  assert.equal(/require\(['"][^.]/.test(code), false, 'no bare requires');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined, 'no runtime dependencies');
});

test('the ESM bundle is importable and agrees with the source', async () => {
  const mod = await import(path.join(ROOT, 'dist', 'live-diagram.esm.js'));
  assert.equal(mod.VERSION, src.VERSION);
  assert.equal(typeof mod.LiveDiagram, 'function');
  const definition = mod.buildDefinition({
    graph: mod.normalizeGraph({ nodes: { a: { label: 'A' } } }),
    snapshot: { states: { a: 'error' } },
    states: mod.normalizeStates(),
    options: {}
  });
  assert.match(definition, /style a fill:#fee2e2/);
});

test('the package version and the exported VERSION agree', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, src.VERSION);
});

test('every file listed in package.json#files exists', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const entry of pkg.files) assert.ok(fs.existsSync(path.join(ROOT, entry)), `${entry} exists`);
});

test('TypeScript declarations are emitted and describe the real API', () => {
  const index = fs.readFileSync(path.join(ROOT, 'dist', 'types', 'index.d.ts'), 'utf8');
  for (const name of ['LiveDiagram', 'hydrate', 'defineLiveDiagram', 'pollSource', 'Timeline']) {
    assert.match(index, new RegExp(`\\b${name}\\b`), `${name} is declared`);
  }
  const cls = fs.readFileSync(path.join(ROOT, 'dist', 'types', 'live-diagram.d.ts'), 'utf8');
  assert.match(cls, /patch\(patch: import\('\.\/state\.js'\)\.StatePatch\)/, 'patch is typed, not `object`');
  assert.match(cls, /graph: import\('\.\/graph\.js'\)\.GraphSpec/, 'the graph option is typed');
});

test('the React entry loads and exports a component and a hook', async () => {
  const mod = await import(path.join(ROOT, 'react', 'index.js'));
  assert.equal(typeof mod.LiveDiagramView, 'function');
  assert.equal(typeof mod.useLiveDiagram, 'function');
  assert.equal(mod.default, mod.LiveDiagramView);
});

test('every export path in package.json resolves to a file that exists', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const walk = (value) => {
    if (typeof value === 'string') {
      if (value.includes('*')) return;
      assert.ok(fs.existsSync(path.join(ROOT, value)), `${value} exists`);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(walk);
    }
  };
  walk(pkg.exports);
  assert.ok(fs.existsSync(path.join(ROOT, pkg.types)), 'types entry exists');
});

test('the element and hydration entry points are in the bundle', () => {
  const bundled = require(path.join(ROOT, 'dist', 'live-diagram.cjs'));
  for (const name of ['defineLiveDiagram', 'hydrate', 'mountSpec', 'autoHydrate']) {
    assert.equal(typeof bundled[name], 'function', `${name} is exported`);
  }
});

test('dist/types has no orphans left behind by a deleted source file', () => {
  const typesDir = path.join(ROOT, 'dist', 'types');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
  for (const declaration of walk(typesDir)) {
    const source = declaration.replace(path.join(ROOT, 'dist', 'types'), path.join(ROOT, 'src')).replace(/\.d\.ts$/, '.js');
    assert.ok(fs.existsSync(source), `${path.relative(ROOT, declaration)} has no source — stale generated file`);
  }
});

test('the minified bundle is emitted with a source map beside it', () => {
  const min = path.join(ROOT, 'dist', 'live-diagram.umd.min.js');
  assert.ok(fs.existsSync(min), 'live-diagram.umd.min.js exists');
  assert.ok(fs.existsSync(min + '.map'), 'live-diagram.umd.min.js.map exists');

  const code = fs.readFileSync(min, 'utf8');
  assert.match(code, /sourceMappingURL=live-diagram\.umd\.min\.js\.map/, 'points at its map');
  assert.match(code.split('\n')[0], /live-diagram v/, 'keeps the banner comment');

  const map = JSON.parse(fs.readFileSync(min + '.map', 'utf8'));
  assert.ok(map.mappings.length > 0, 'the map has mappings');
  assert.ok(map.sourcesContent && map.sourcesContent.length > 0, 'the map carries the source');
});

test('the minified bundle is smaller than the readable one and still parses', () => {
  const readable = fs.readFileSync(path.join(ROOT, 'dist', 'live-diagram.umd.js'), 'utf8');
  const minified = fs.readFileSync(path.join(ROOT, 'dist', 'live-diagram.umd.min.js'), 'utf8');
  assert.ok(minified.length < readable.length / 2, 'less than half the bytes');
  new vm.Script(minified, { filename: 'live-diagram.umd.min.js' });   // throws on a syntax error
});

test('the minified bundle exports exactly what src/index.js does', () => {
  // The UMD wrapper looks for `module`/`exports` first, so give it neither and
  // let it attach to the global — which is the browser path, the one that
  // actually loads this file.
  const sandbox = { window: {}, self: {}, document: undefined };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  new vm.Script(fs.readFileSync(path.join(ROOT, 'dist', 'live-diagram.umd.min.js'), 'utf8'), {
    filename: 'live-diagram.umd.min.js'
  }).runInContext(sandbox);

  const ns = sandbox.window.LiveDiagram || sandbox.LiveDiagram;
  assert.equal(typeof ns, 'function', 'the class is the global namespace');
  const expected = Object.keys(src).filter((k) => k !== 'default' && k !== 'LiveDiagram').sort();
  for (const name of expected) {
    assert.ok(name in ns, `${name} survives minification`);
  }
  assert.equal(ns.VERSION, src.VERSION);
});

test('the size budget passes', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'size.js')], { cwd: ROOT, stdio: 'pipe' });
});

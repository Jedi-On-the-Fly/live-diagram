#!/usr/bin/env node
/**
 * The whole build system: ~90 lines, no dependencies.
 *
 * The source is plain ES modules. This script resolves the import graph,
 * concatenates it in dependency order and emits two single files — one ESM,
 * one UMD — so the library can be used from a bundler OR from a <script> tag
 * with no toolchain at all. A build step is a barrier to adoption; refusing to
 * need one is a feature.
 *
 * It supports exactly the syntax this codebase uses and shouts about anything
 * else, which is the honest way to write 90 lines instead of importing 900k.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { minify } from 'terser';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'src', 'index.js');
const OUT_DIR = path.join(ROOT, 'dist');

const IMPORT_RE = /import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g;
const EXPORT_BLOCK_RE = /export\s*\{([\s\S]*?)\};?/g;

/** Reads a module and returns its dependencies and stripped body. */
function readModule(file) {
  const source = fs.readFileSync(file, 'utf8');
  const deps = [];
  let body = source.replace(IMPORT_RE, (_, names, specifier) => {
    if (!specifier.startsWith('.')) {
      throw new Error(`${path.relative(ROOT, file)}: bare import "${specifier}" — this library has no dependencies`);
    }
    deps.push(path.resolve(path.dirname(file), specifier));
    return '';
  });

  const exported = [];
  body = body.replace(EXPORT_BLOCK_RE, (_, names) => {
    names.split(',').map((n) => n.trim()).filter(Boolean).forEach((n) => {
      if (n.includes(' as ')) throw new Error(`${path.relative(ROOT, file)}: aliased exports are not supported`);
      exported.push(n);
    });
    return '';
  });

  body = body.replace(/^export\s+(default\s+)?/gm, (match, isDefault) => {
    if (isDefault) throw new Error(`${path.relative(ROOT, file)}: default exports are not supported`);
    return '';
  });

  // Names declared with `export function foo` / `export const foo`.
  for (const match of source.matchAll(/^export\s+(?:async\s+)?(?:function|class|const|let)\s+([A-Za-z0-9_$]+)/gm)) {
    if (!exported.includes(match[1])) exported.push(match[1]);
  }

  return { file, deps, body: body.trim(), exported };
}

/** Depth-first topological order, entry last. */
function order(entry) {
  const seen = new Map();
  const out = [];
  const visit = (file, stack) => {
    if (seen.has(file)) return;
    if (stack.includes(file)) throw new Error(`Import cycle: ${stack.concat(file).map((f) => path.relative(ROOT, f)).join(' -> ')}`);
    const mod = readModule(file);
    seen.set(file, mod);
    for (const dep of mod.deps) visit(dep, stack.concat(file));
    out.push(mod);
  };
  visit(entry, []);
  return out;
}

const modules = order(ENTRY);

// One flat scope means two modules cannot both declare `MARK`. The bundle would
// still be written and would throw "already declared" only when someone loaded
// it, so the check belongs here, loudly, at build time.
const declaredIn = new Map();
for (const mod of modules) {
  const names = new Set();
  for (const match of mod.body.matchAll(/^(?:const|let|var|function|class|async function)\s+([A-Za-z0-9_$]+)/gm)) {
    names.add(match[1]);
  }
  for (const name of names) {
    if (declaredIn.has(name)) {
      throw new Error(`Duplicate top-level name "${name}" in ${path.relative(ROOT, mod.file)} and ${path.relative(ROOT, declaredIn.get(name))} — the bundle shares one scope, so rename one of them`);
    }
    declaredIn.set(name, mod.file);
  }
}
const entryModule = modules[modules.length - 1];
const names = entryModule.exported;
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const banner = `/*! ${pkg.name} v${pkg.version} — ${pkg.description}\n *  ${pkg.homepage || ''}\n *  MIT licensed. Built by scripts/build.js — do not edit dist/ by hand.\n */`;
const body = modules.map((m) => `// ── ${path.relative(ROOT, m.file)} ${'─'.repeat(Math.max(0, 58 - path.relative(ROOT, m.file).length))}\n${m.body}`).join('\n\n');

for (const leftover of body.matchAll(/^\s*(import|export)\s/gm)) {
  throw new Error(`Unhandled ${leftover[1]} statement survived the strip — check scripts/build.js`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

fs.writeFileSync(path.join(OUT_DIR, 'live-diagram.esm.js'),
  `${banner}\n\n${body}\n\nexport {\n  ${names.join(',\n  ')}\n};\n`);

const umd = `${banner}
(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
  typeof define === 'function' && define.amd ? define(['exports'], factory) :
  factory({}, global);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (exports, global) {
  'use strict';

${body.split('\n').map((line) => (line ? `  ${line}` : '')).join('\n')}

${names.map((n) => `  exports.${n} = ${n};`).join('\n')}
  Object.defineProperty(exports, '__esModule', { value: true });

  // The class doubles as the namespace: \`new LiveDiagram(...)\` and
  // \`LiveDiagram.mermaidRenderer()\` both work from a plain <script> tag.
  Object.assign(LiveDiagram, exports);
  if (global && typeof global === 'object') global.LiveDiagram = LiveDiagram;

  // The UMD build is the drop-it-in-a-page path, so it registers the custom
  // element and honours <script … data-auto> on itself. The ESM entry does
  // neither: importing a module should not touch the document.
  if (typeof customElements !== 'undefined') defineLiveDiagram();
  if (typeof document !== 'undefined') autoHydrate(document.currentScript);
}));
`;

// Two copies of the same UMD bundle on purpose: browsers get `.js` (a <script>
// tag and a sane MIME type from every static host), Node's `require()` gets
// `.cjs` (this package is "type": "module", so a required `.js` would be
// parsed as ESM and hand the caller an empty namespace).
fs.writeFileSync(path.join(OUT_DIR, 'live-diagram.umd.js'), umd);
fs.writeFileSync(path.join(OUT_DIR, 'live-diagram.cjs'), umd);

// Parse what was written. A stray backtick in a CSS template literal produces
// a bundle that is valid-looking text and a SyntaxError at load time; the
// browser is a bad place to find that out.
for (const [file, kind] of [['live-diagram.umd.js', 'script'], ['live-diagram.esm.js', 'module']]) {
  const code = fs.readFileSync(path.join(OUT_DIR, file), 'utf8');
  try {
    if (kind === 'module') new vm.SourceTextModule(code, { identifier: file });
    else new vm.Script(code, { filename: file });
  } catch (err) {
    if (/SourceTextModule/.test(String(err))) continue;   // needs --experimental-vm-modules
    throw new Error(`${file} does not parse: ${err.message}`);
  }
}

// A minified twin of the UMD build, which is the one that travels over a
// network. The readable files stay: ESM and CJS are read by bundlers and by
// Node, which do not care about bytes, and the unminified UMD is what the
// source map points at.
//
// Comments are ~40% of these bytes. They earn their place in src/ and have no
// business in a browser.
const readable = fs.readFileSync(path.join(OUT_DIR, 'live-diagram.umd.js'), 'utf8');
const minified = await minify(readable, {
  compress: { passes: 2 },
  mangle: true,
  format: { comments: /^!/ },          // keep the banner, drop the rest
  sourceMap: { filename: 'live-diagram.umd.min.js', url: 'live-diagram.umd.min.js.map', includeSources: true }
});
if (minified.error) throw minified.error;
fs.writeFileSync(path.join(OUT_DIR, 'live-diagram.umd.min.js'), minified.code);
fs.writeFileSync(path.join(OUT_DIR, 'live-diagram.umd.min.js.map'), minified.map);
new vm.Script(minified.code, { filename: 'live-diagram.umd.min.js' });

const sizes = fs.readdirSync(OUT_DIR)
  .filter((f) => f.endsWith('.js') || f.endsWith('.cjs'))
  .map((f) => {
    const bytes = fs.readFileSync(path.join(OUT_DIR, f));
    return `${f}: ${(bytes.length / 1024).toFixed(1)} KB  (${(zlib.gzipSync(bytes).length / 1024).toFixed(1)} KB gzipped)`;
  });
console.log(`built ${modules.length} modules, ${names.length} exports\n  ${sizes.join('\n  ')}`);

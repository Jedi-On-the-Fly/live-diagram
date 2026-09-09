#!/usr/bin/env node
/**
 * The size budget.
 *
 * Weight is a feature that erodes silently: nobody ever adds 40 KB, they add
 * 400 bytes forty times. The ceilings live in package.json#sizeLimits (gzipped
 * KB, because that is what the network moves) and this script fails the build
 * when one is breached — which makes the conversation happen in the pull
 * request that caused it rather than a year later.
 *
 * Raising a ceiling is allowed. Raising it without noticing is not.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const limits = pkg.sizeLimits || {};

if (!Object.keys(limits).length) {
  console.error('package.json#sizeLimits is empty — nothing to check.');
  process.exit(1);
}

const rows = [];
let failed = false;

for (const [file, limit] of Object.entries(limits)) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) {
    console.error(`missing: ${file} — run \`npm run build\` first`);
    failed = true;
    continue;
  }
  const bytes = fs.readFileSync(full);
  const raw = bytes.length / 1024;
  const gz = zlib.gzipSync(bytes, { level: 9 }).length / 1024;
  const over = gz > limit;
  if (over) failed = true;
  rows.push({ file, raw, gz, limit, over });
}

const width = Math.max(...rows.map((r) => r.file.length), 4);
console.log(`${'file'.padEnd(width)}    raw      gzip     budget`);
for (const r of rows) {
  const mark = r.over ? '  ✗ over budget' : '';
  console.log(
    `${r.file.padEnd(width)}  ${r.raw.toFixed(1).padStart(6)} KB  ${r.gz.toFixed(1).padStart(5)} KB  ${String(r.limit).padStart(5)} KB${mark}`
  );
}

if (failed) {
  console.error(
    '\nOver budget. Either make it smaller, or raise the ceiling in package.json#sizeLimits\n' +
    'in the same commit — so the growth is a decision someone signed for.'
  );
  process.exit(1);
}

const headroom = Math.min(...rows.map((r) => r.limit - r.gz));
console.log(`\nAll within budget (tightest headroom: ${headroom.toFixed(1)} KB).`);

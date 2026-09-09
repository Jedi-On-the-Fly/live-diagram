/**
 * Documentation drift is a bug like any other: a README that promises an export
 * the library does not have, or links a file that was renamed, costs an adopter
 * more than a broken function would. These are the checks a human keeps
 * forgetting.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '../src/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const DOCS = ['README.md', 'llms.txt', 'AGENTS.md', 'CHANGELOG.md', 'RELEASING.md', 'integrations/README.md', 'skills/README.md'];

test('every symbol the README says is exported really is', () => {
  const section = read('README.md').match(/Also exported:([\s\S]*?)\n\n/);
  assert.ok(section, 'the exports paragraph is still there');
  const names = [...section[1].matchAll(/`([A-Za-z][A-Za-z0-9_]*)`/g)].map((m) => m[1]);
  assert.ok(names.length > 10, 'and it still lists things');
  for (const name of names) {
    assert.ok(name in api, `${name} is exported from src/index.js`);
  }
});

test('code fences in the docs name a language, so they highlight', () => {
  for (const file of DOCS) {
    const opens = [...read(file).matchAll(/^```(\w*)/gm)].map((m) => m[1]);
    // Fences alternate open/close; every other one is a closer with no language.
    const languages = opens.filter((_, i) => i % 2 === 0);
    for (const language of languages) {
      assert.notEqual(language, '', `a fence in ${file} has no language`);
    }
  }
});

test('every relative link in the docs points at a file that exists', () => {
  const skip = /^(https?:|mailto:|#)/;
  for (const file of DOCS) {
    const dir = path.dirname(path.join(ROOT, file));
    for (const match of read(file).matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || skip.test(target)) continue;
      assert.ok(fs.existsSync(path.resolve(dir, target)), `${file} links ${target}, which does not exist`);
    }
  }
});

test('the demo index links every demo page, and every demo page exists', () => {
  const index = read('demo/index.html');
  const pages = fs.readdirSync(path.join(ROOT, 'demo')).filter((f) => f.endsWith('.html') && f !== 'index.html');
  for (const page of pages) {
    assert.match(index, new RegExp(`href="${page}"`), `demo/index.html links ${page}`);
  }
  for (const match of index.matchAll(/href="([^"]+\.html)"/g)) {
    assert.ok(fs.existsSync(path.join(ROOT, 'demo', match[1])), `demo/index.html links a missing ${match[1]}`);
  }
});

test('the version is the same in every place that states it', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(api.VERSION, pkg.version);
  assert.match(read('CHANGELOG.md'), new RegExp(`## \\[${pkg.version.replace(/\./g, '\\.')}\\]`), 'the changelog has an entry');
  assert.match(read('dist/live-diagram.umd.js').split('\n')[0], new RegExp(`v${pkg.version.replace(/\./g, '\\.')}`), 'dist was rebuilt');
});

test('nothing in src/ outside kit/ imports the kit', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
  for (const file of walk(path.join(ROOT, 'src'))) {
    if (file.includes(`${path.sep}kit${path.sep}`) || file.endsWith(`${path.sep}index.js`)) continue;
    assert.equal(/from '.*kit\//.test(fs.readFileSync(file, 'utf8')), false,
      `${path.relative(ROOT, file)} imports the kit, which must stay optional`);
  }
});

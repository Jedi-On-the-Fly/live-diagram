/**
 * Skills drift is documentation drift with higher stakes: a skill is followed
 * with confidence, by an agent, without the sideways glance a human gives a
 * README. So the API facts the skills in skills/ state are checked against the
 * source the same way docs.test.js checks the README — a skill that quietly
 * went stale fails here, not in someone's session.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '../src/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const SKILLS_DIR = path.join(ROOT, 'skills');
const skillDirs = fs.readdirSync(SKILLS_DIR)
  .filter((entry) => fs.existsSync(path.join(SKILLS_DIR, entry, 'SKILL.md')));
const skills = Object.fromEntries(
  skillDirs.map((dir) => [dir, read(path.join('skills', dir, 'SKILL.md'))])
);

test('the four skills are present', () => {
  assert.deepEqual(skillDirs.sort(), [
    'live-diagram-embed', 'live-diagram-from-data', 'live-diagram-release', 'live-diagram-troubleshoot'
  ]);
});

test('every skill has frontmatter whose name matches its folder', () => {
  for (const [dir, text] of Object.entries(skills)) {
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(fm, `${dir} has frontmatter`);
    const name = fm[1].match(/^name:\s*(\S+)\s*$/m);
    const description = fm[1].match(/^description:\s*(.+)$/m);
    assert.equal(name && name[1], dir, `${dir}: frontmatter name matches the folder`);
    assert.ok(description && description[1].length > 40,
      `${dir}: has a description substantial enough to trigger on`);
  }
});

test('every skill states the library version it was written against, and it is current', () => {
  const pkg = JSON.parse(read('package.json'));
  const minor = pkg.version.split('.').slice(0, 2).join('.');
  for (const [dir, text] of Object.entries(skills)) {
    const claim = text.match(/Written against live-diagram (\d+\.\d+)\.x/);
    assert.ok(claim, `${dir} says which version it describes`);
    assert.equal(claim[1], minor,
      `${dir} was written against ${claim[1]}.x but the library is ${pkg.version} — re-read it, then move its version line`);
  }
});

test('every export a skill imports from the package really exists', () => {
  const reactSource = read('react/index.js');
  for (const [dir, text] of Object.entries(skills)) {
    for (const m of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*'live-diagram'/g)) {
      for (const name of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        assert.ok(name in api, `${dir} imports ${name}, which src/index.js does not export`);
      }
    }
    for (const m of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*'live-diagram\/react'/g)) {
      for (const name of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        assert.match(reactSource, new RegExp(`export (?:function|const) ${name}\\b`),
          `${dir} imports ${name} from live-diagram/react, which react/index.js does not export`);
      }
    }
  }
});

test('the vocabulary the embed skill lists is the vocabulary that ships', () => {
  const claim = skills['live-diagram-embed'].match(/vocabulary is `([^`]+)`/);
  assert.ok(claim, 'the embed skill still lists the built-in vocabulary');
  assert.deepEqual(claim[1].split('|').map((s) => s.trim()), Object.keys(api.DEFAULT_STATES));
});

test('the DOM events the embed skill promises are the ones the element dispatches', () => {
  const dispatched = new Set(
    [...read('src/element.js').matchAll(/_emit\('([a-z]+)'/g)].map((m) => m[1])
  );
  for (const name of ['nodeclick', 'nodehover', 'statechange', 'ready', 'diagramerror']) {
    assert.ok(skills['live-diagram-embed'].includes(`\`${name}\``),
      `the embed skill documents the ${name} event`);
    assert.ok(dispatched.has(name), `the element dispatches ${name}`);
  }
});

test('the methods the embed skill says the element forwards are really forwarded', () => {
  const element = read('src/element.js');
  for (const method of ['patch', 'snapshot', 'restore', 'timeline', 'connect', 'fit']) {
    assert.match(element, new RegExp(`^\\s{4}${method}\\(`, 'm'),
      `<live-diagram> forwards ${method}()`);
  }
});

test('numbers the skills state match the code', () => {
  assert.ok(skills['live-diagram-troubleshoot'].includes('1.75'),
    'the troubleshoot skill states the maxFitScale default');
  assert.ok(read('src/viewport.js').includes('1.75'),
    'the maxFitScale default is still what the troubleshoot skill says');
  assert.ok(skills['live-diagram-troubleshoot'].includes('420px'),
    'the troubleshoot skill states the element default height');
  assert.ok(read('src/element.js').includes("'420px'"),
    'the element default height is still what the troubleshoot skill says');
  const buildLines = read('scripts/build.js').split('\n').length;
  assert.ok(buildLines < 200,
    `the release skill says the bundler is under 200 lines; it is ${buildLines}`);
});

test('error messages the troubleshoot skill quotes are the ones the library prints', () => {
  assert.ok(read('src/hydrate.js').includes('neither valid JSON nor Mermaid source'));
  assert.ok(read('src/live-diagram.js').includes('mount target'));
});

test('code fences in the skills name a language', () => {
  for (const [dir, text] of Object.entries(skills)) {
    // A four-backtick fence wraps example markdown that itself contains
    // fences; everything inside one is content, not structure.
    let insideOuter = false;
    let open = false;
    for (const line of text.split('\n')) {
      if (/^````/.test(line)) { insideOuter = !insideOuter; continue; }
      if (insideOuter) continue;
      const fence = /^```(\w*)/.exec(line);
      if (!fence) continue;
      if (!open) assert.notEqual(fence[1], '', `a fence in ${dir} has no language`);
      open = !open;
    }
    assert.equal(open, false, `${dir} closes every fence it opens`);
  }
});

test('relative links in the skills point at files that exist', () => {
  const skip = /^(https?:|mailto:|#)/;
  for (const [dir, text] of Object.entries(skills)) {
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || skip.test(target)) continue;
      assert.ok(fs.existsSync(path.resolve(SKILLS_DIR, dir, target)),
        `${dir} links ${target}, which does not exist`);
    }
  }
});

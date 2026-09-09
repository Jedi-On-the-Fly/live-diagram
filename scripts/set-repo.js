#!/usr/bin/env node
/**
 * Stamps the repository coordinates through the project in one command:
 *
 *   node scripts/set-repo.js <owner>/<repo>
 *
 * A published package with a placeholder URL is worse than one with none, and
 * hand-editing five files on release day is how the placeholder survives.
 * This writes package.json (repository, homepage, bugs), the README's install
 * and demo links, and the demo index's own footer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2];

if (!slug || !/^[\w.-]+\/[\w.-]+$/.test(slug)) {
  console.error('usage: node scripts/set-repo.js <owner>/<repo>   (e.g. mid/live-diagram)');
  process.exit(1);
}

const [owner, repo] = slug.split('/');
const repoUrl = `https://github.com/${slug}`;
const pagesUrl = `https://${owner.toLowerCase()}.github.io/${repo}`;

const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.repository = { type: 'git', url: `git+${repoUrl}.git` };
pkg.homepage = `${pagesUrl}/demo/`;
pkg.bugs = { url: `${repoUrl}/issues` };
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

const PLACEHOLDER = /https:\/\/github\.com\/YOUR-ORG\/live-diagram|https:\/\/your-org\.github\.io\/live-diagram/g;
let touched = ['package.json'];

for (const file of ['README.md', 'demo/index.html', 'CHANGELOG.md', 'integrations/README.md', 'demo/data/github-run.json']) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) continue;
  const before = fs.readFileSync(full, 'utf8');
  const after = before
    .replace(/https:\/\/your-org\.github\.io\/live-diagram/g, pagesUrl)
    .replace(/https:\/\/github\.com\/YOUR-ORG\/live-diagram/g, repoUrl);
  if (after !== before) { fs.writeFileSync(full, after); touched.push(file); }
}

console.log(`repository: ${repoUrl}\npages:      ${pagesUrl}/demo/\nupdated:    ${touched.join(', ')}`);
if (PLACEHOLDER.test(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8'))) {
  console.error('warning: placeholders still present in README.md');
}

/**
 * Fetches the Mermaid build the demos and the browser tests prefer to load
 * into `demo/vendor/`, so neither needs the network once it has run.
 *
 * A no-op when the file is already there; delete it to re-fetch. On a fetch
 * failure it warns and exits cleanly rather than blocking the caller — every
 * page that looks in `demo/vendor/` falls back to the CDN anyway, so a missing
 * vendor file degrades to exactly the behaviour this script exists to improve.
 * The version is pinned to the one every CDN snippet in the docs names.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '10.9.1';
const SOURCE = `https://cdnjs.cloudflare.com/ajax/libs/mermaid/${VERSION}/mermaid.min.js`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(ROOT, 'demo', 'vendor', 'mermaid.min.js');

if (fs.existsSync(target)) process.exit(0);

try {
  console.log(`fetching mermaid ${VERSION} → demo/vendor/mermaid.min.js`);
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
} catch (error) {
  console.warn(`vendor-mermaid: could not fetch (${error.message}); pages will use the CDN instead`);
}

#!/usr/bin/env node
/** A 40-line static server for the demos: `npm run demo`, then open the URL. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.gif': 'image/gif', '.map': 'application/json'
};

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const target = path.normalize(path.join(ROOT, url === '/' ? '/demo/index.html' : url));
  if (!target.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(target, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(target)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`demos: http://localhost:${PORT}/demo/index.html`));

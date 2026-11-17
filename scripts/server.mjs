// SPDX-License-Identifier: MIT
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allowed = new Set(['index.html', 'assets/app.css', 'assets/app.js', 'assets/core.js', 'assets/favicon.svg', 'data/demo-rates.js']);
const mime = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', svg: 'image/svg+xml' };
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT 须为 1024–65535。');
const server = createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).replace(/^\//, '') || 'index.html';
    if (!allowed.has(path)) { res.writeHead(404); res.end('Not found'); return; }
    const content = await readFile(resolve(root, path));
    res.writeHead(200, { 'Content-Type': mime[path.split('.').pop()] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (_) { res.writeHead(400); res.end('Bad request'); }
});
server.listen(port, '127.0.0.1', () => console.log('GENORDA 本地预览：http://127.0.0.1:' + port));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));

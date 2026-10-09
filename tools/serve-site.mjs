import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { safeRelativePath } from './site-lib.mjs';
import { PUBLIC_FILES, securityHeaders } from './package-site.mjs';

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.neon', 'text/plain; charset=utf-8'], ['.xml', 'application/xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'], ['.webp', 'image/webp'], ['.avif', 'image/avif'], ['.ico', 'image/x-icon']
]);
const headers = Object.fromEntries(securityHeaders.map(header => {
  const colon = header.indexOf(':');
  return [header.slice(0, colon), header.slice(colon + 1).trim()];
}));

export function createSiteServer({ root = process.cwd(), source = 'games.neon' } = {}) {
  root = path.resolve(root);
  safeRelativePath(source, 'Game source');
  if (!source.endsWith('.neon') || !fs.existsSync(path.join(root, source))) throw new Error(`Game source does not exist: ${source}`);
  return http.createServer((request, response) => {
    const send = (status, body) => { response.writeHead(status, { ...headers, 'Content-Type': 'text/html; charset=utf-8' }); response.end(request.method === 'HEAD' ? undefined : body); };
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { send(405, 'Method not allowed'); return; }
      const url = new URL(request.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      const legacy = pathname.match(/^\/(home|upcoming|past|about)\/?$/) || pathname.match(/^\/(games?)\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/);
      if (legacy) {
        const route = legacy[2] ? `game/${legacy[2]}` : legacy[1];
        // Source-root previews use the same compatibility script as deployed shells.
        const html = `<!doctype html><html><head><script src="/scripts/legacy.js" data-root="/" data-legacy-route="${route}" defer></script></head><body><a href="/${url.search}#${route}">Continue</a></body></html>`;
        send(200, html); return;
      }
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
      const absolute = path.resolve(root, relative === 'games.neon' ? source : relative);
      const isPublic = PUBLIC_FILES.some(file => relative === file || (!path.extname(file) && relative.startsWith(`${file}/`)))
        || /^[a-zA-Z0-9_-]+\.neon$/.test(relative) || ['robots.txt', 'sitemap.xml', '404.html'].includes(relative);
      if (!isPublic || !absolute.startsWith(`${root}${path.sep}`) || relative.split('/').some(part => part.startsWith('.')) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
        send(404, '<!doctype html><html><body><h1>Page not found</h1><a href="/#home">Return home</a></body></html>'); return;
      }
      response.writeHead(200, { ...headers, 'Content-Type': contentTypes.get(path.extname(absolute).toLowerCase()) || 'application/octet-stream', 'Cache-Control': 'no-store' });
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = fs.createReadStream(absolute);
      stream.on('error', () => response.destroy());
      stream.pipe(response);
    } catch { send(400, 'Invalid request'); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1] ?? 'true']);
    return pairs;
  }, []));
  const port = Number(args.port || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  const server = createSiteServer(args);
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log(`Local site running at ${url}\nPress Ctrl+C to stop.`);
    if (args.open === 'true') spawn('cmd.exe', ['/d', '/s', '/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  });
}

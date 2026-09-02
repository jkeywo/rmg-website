import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1] ?? 'true']);
  return pairs;
}, []));
const root = path.resolve(args.root || '.local-site');
const port = Number(args.port || 4173);
const host = '127.0.0.1';

if (!fs.existsSync(root)) throw new Error(`Site directory does not exist: ${root}`);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${args.port}`);

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8'], ['.txt', 'text/plain; charset=utf-8'],
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'],
  ['.webp', 'image/webp'], ['.avif', 'image/avif'], ['.ico', 'image/x-icon']
]);

function resolveRequest(urlValue) {
  const pathname = decodeURIComponent(new URL(urlValue, `http://${host}`).pathname);
  const relative = pathname.replace(/^\/+/, '');
  const candidates = pathname.endsWith('/')
    ? [path.join(relative, 'index.html')]
    : [relative, `${relative}.html`, path.join(relative, 'index.html')];
  for (const candidate of candidates) {
    const absolute = path.resolve(root, candidate);
    if (absolute.startsWith(`${root}${path.sep}`) && fs.existsSync(absolute) && fs.statSync(absolute).isFile()) return absolute;
  }
  return path.join(root, '404.html');
}

const server = http.createServer((request, response) => {
  try {
    const file = resolveRequest(request.url);
    response.writeHead(path.basename(file) === '404.html' ? 404 : 200, {
      'Content-Type': contentTypes.get(path.extname(file).toLowerCase()) || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    if (request.method === 'HEAD') return response.end();
    fs.createReadStream(file).pipe(response);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(`Local server error: ${error.message}`);
  }
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Stop the other server and try again.`);
    process.exitCode = 1;
    return;
  }
  throw error;
});

server.listen(port, host, () => {
  const url = `http://${host}:${port}/`;
  console.log(`Local site running at ${url}`);
  console.log('Press Ctrl+C to stop.');
  if (args.open === 'true') {
    spawn('cmd.exe', ['/d', '/s', '/c', 'start', '""', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    }).unref();
  }
});

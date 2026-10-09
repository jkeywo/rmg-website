import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml, readGames, safeExternalUrl } from './site-lib.mjs';

export const PUBLIC_FILES = ['index.html', 'games.neon', 'content/site.json', 'scripts', 'styles', 'logos', 'images', 'photos', 'carousel', 'favicon.ico'];
const PRODUCTION_URL = 'https://readingmegagames.co.uk/';

export function legacyRoutes(games) {
  return new Map([
    ['home', 'home'], ['upcoming', 'upcoming'], ['past', 'past'], ['about', 'about'],
    ...games.flatMap(game => [[`games/${game.slug}`, `game/${game.slug}`], [`game/${game.slug}`, `game/${game.slug}`]])
  ]);
}

export function redirectShell(route, depth) {
  const root = '../'.repeat(depth);
  const target = `${root}#${route}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Reading Megagames</title><link rel="canonical" href="${PRODUCTION_URL}"><script src="${root}scripts/legacy.js" data-root="${root}" data-legacy-route="${escapeHtml(route)}" defer></script></head><body><main><h1>Reading Megagames</h1><p><a href="${target}">Continue to this page</a>.</p></main></body></html>\n`;
}

export const securityHeaders = [
  'X-Content-Type-Options: nosniff',
  'Referrer-Policy: strict-origin-when-cross-origin',
  'Permissions-Policy: camera=(), geolocation=(), microphone=()',
  "Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-src https://www-readingmegagames-com.filesusr.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
];

export async function packageSite({ root = process.cwd(), output = 'dist', source = 'games.neon', environment = 'production' } = {}) {
  root = path.resolve(root);
  const destination = path.resolve(root, output);
  // Only these disposable directories may be replaced; never delete an arbitrary CLI path.
  if (![path.join(root, 'dist'), path.join(root, '.local-site')].includes(destination)) throw new Error('Output must be dist or .local-site within the site root');
  if (!['production', 'staging', 'local'].includes(environment)) throw new Error(`Unknown environment: ${environment}`);
  if ((await fs.lstat(destination).catch(() => null))?.isSymbolicLink()) throw new Error('Output must not be a symbolic link');
  const games = readGames(source, root);
  const content = JSON.parse(await fs.readFile(path.join(root, 'content/site.json'), 'utf8'));
  for (const value of [content.discordUrl, content.mailingListUrl, content.about.assemblyUrl]) safeExternalUrl(value, 'Site content');
  // Validate public inputs before replacing the last package.
  for (const file of PUBLIC_FILES) await fs.access(path.join(root, file));
  const gameBytes = await fs.readFile(path.resolve(root, source));
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });
  for (const file of PUBLIC_FILES) {
    await fs.mkdir(path.dirname(path.join(destination, file)), { recursive: true });
    await fs.cp(path.join(root, file), path.join(destination, file), { recursive: true });
  }
  await fs.writeFile(path.join(destination, 'games.neon'), gameBytes);
  const shellPath = path.join(destination, 'index.html');
  const robots = environment === 'production' ? '' : '<meta name="robots" content="noindex,nofollow">';
  await fs.writeFile(shellPath, (await fs.readFile(shellPath, 'utf8')).replace('<!-- environment:robots -->', robots));
  for (const [route, hash] of legacyRoutes(games)) {
    await fs.mkdir(path.join(destination, route), { recursive: true });
    await fs.writeFile(path.join(destination, route, 'index.html'), redirectShell(hash, route.split('/').length));
  }
  await fs.writeFile(path.join(destination, '404.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Page not found | Reading Megagames</title></head><body><main><h1>Page not found</h1><p><a href="/#home">Return to Reading Megagames</a>.</p></main></body></html>\n`);
  await fs.writeFile(path.join(destination, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${PRODUCTION_URL}</loc></url></urlset>\n`);
  await fs.writeFile(path.join(destination, 'robots.txt'), environment === 'production' ? `User-agent: *\nAllow: /\nSitemap: ${PRODUCTION_URL}sitemap.xml\n` : 'User-agent: *\nDisallow: /\n');
  await fs.writeFile(path.join(destination, '_headers'), `/*\n${[...securityHeaders, 'Cache-Control: public, max-age=0, must-revalidate'].map(value => `  ${value}`).join('\n')}\n`);
  await fs.writeFile(path.join(destination, '_redirects'), '/home /#home 301\n/game/:slug /#game/:slug 301\n');
  await fs.writeFile(path.join(destination, '.nojekyll'), '');
  if (environment === 'staging') await fs.writeFile(path.join(destination, 'CNAME'), 'test.readingmegagames.co.uk\n');
  console.log(`Packaged ${games.length} games with original assets; content renders in the browser.`);
  return destination;
}

export async function main(values = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index].replace(/^--/, '');
    if (!['output', 'source', 'environment', 'base-url'].includes(key) || !values[index + 1]) throw new Error(`Invalid argument: ${values[index]}`);
    // Kept for the old build command; all published paths are now relative.
    if (key !== 'base-url') options[key] = values[index + 1];
  }
  await packageSite(options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

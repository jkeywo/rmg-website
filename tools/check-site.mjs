import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGames } from './site-lib.mjs';
import { legacyRoutes, PUBLIC_FILES } from './package-site.mjs';

export async function checkSite(root = 'dist') {
  root = path.resolve(root);
  const games = readGames('games.neon', root);
  for (const file of PUBLIC_FILES) await fs.access(path.join(root, file));
  const index = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  if (!index.includes('type="module" src="scripts/app.js"') || !index.includes('id="app"')) throw new Error('Missing browser application shell');
  if (games.some(game => index.includes(`id="${game.slug}"`) || index.includes(game.description))) throw new Error('Game content must not be rendered into the shell');
  const allowedRoots = new Set([...PUBLIC_FILES.map(file => file.split('/')[0]), 'home', 'upcoming', 'past', 'about', 'game', 'games', '404.html', 'robots.txt', 'sitemap.xml', '_headers', '_redirects', '.nojekyll', 'CNAME']);
  for (const file of await fs.readdir(root)) if (!allowedRoots.has(file)) throw new Error(`Unexpected public file: ${file}`);
  for (const [route, hash] of legacyRoutes(games)) {
    const html = await fs.readFile(path.join(root, route, 'index.html'), 'utf8');
    if (!html.includes(`data-legacy-route="${hash}"`)) throw new Error(`Missing legacy redirect: ${route}`);
  }
  for (const match of index.matchAll(/(?:href|src)="([^"#]+)"/g)) {
    if (/^(https:|mailto:)/.test(match[1])) continue;
    await fs.access(path.join(root, decodeURIComponent(match[1])));
  }
  const robots = await fs.readFile(path.join(root, 'robots.txt'), 'utf8');
  if (robots.includes('Disallow: /') && !index.includes('name="robots" content="noindex,nofollow"')) throw new Error('Staging shell is indexable');
  const sitemap = await fs.readFile(path.join(root, 'sitemap.xml'), 'utf8');
  if ((sitemap.match(/<loc>/g) || []).length !== 1 || sitemap.includes('#')) throw new Error('Sitemap must contain only the root document');
  const headers = await fs.readFile(path.join(root, '_headers'), 'utf8');
  if (!headers.includes('must-revalidate') || headers.includes('immutable')) throw new Error('Unversioned files must revalidate');
  const photos = games.reduce((total, game) => total + game.photos.length, 0);
  console.log(`Validated ${games.length} games and ${photos} photos in the browser-rendered package.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkSite(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
}

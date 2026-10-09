import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { packageSite } from '../tools/package-site.mjs';
import { checkSite } from '../tools/check-site.mjs';
import { createSiteServer } from '../tools/serve-site.mjs';

const fixture = '-\nname: Package Example\nslug: 2026-10-example\ndate: 10 October 2026\ndescription: Text rendered only by the browser.\nlistImage: images/example.jpg\nbannerImage: images/example.jpg\nphotos: one.jpg\n';

async function fixtureRoot(t) {
  const cache = path.resolve('.cache');
  await fs.mkdir(cache, { recursive: true });
  const root = await fs.mkdtemp(path.join(cache, 'package-test-'));
  t.after(async () => {
    if (!root.startsWith(`${cache}${path.sep}package-test-`)) throw new Error('Unsafe test cleanup path');
    await fs.rm(root, { recursive: true, force: true });
  });
  for (const folder of ['content', 'scripts', 'styles', 'logos', 'images', 'photos/2026-10-example', 'carousel']) await fs.mkdir(path.join(root, folder), { recursive: true });
  for (const file of ['index.html', 'content/site.json', 'scripts/app.js', 'scripts/legacy.js', 'styles/site.css', 'favicon.ico', 'logos/RMG Logotype.png']) await fs.copyFile(file, path.join(root, file));
  await fs.writeFile(path.join(root, 'games.neon'), fixture);
  await fs.writeFile(path.join(root, 'test.neon'), fixture.replace('Package Example', 'Alternate Example'));
  await fs.writeFile(path.join(root, 'images/example.jpg'), 'original image bytes');
  await fs.writeFile(path.join(root, 'photos/2026-10-example/one.jpg'), 'original photo bytes');
  await fs.writeFile(path.join(root, 'private.txt'), 'must not publish');
  return root;
}

test('packages original files, redirect-only legacy pages and environment metadata', async t => {
  const root = await fixtureRoot(t);
  const output = await packageSite({ root });
  await checkSite(output);
  assert.equal(await fs.readFile(path.join(output, 'images/example.jpg'), 'utf8'), 'original image bytes');
  assert.equal(await fs.readFile(path.join(output, 'games.neon'), 'utf8'), fixture);
  assert.equal(await fs.readFile(path.join(output, 'scripts/app.js'), 'utf8'), await fs.readFile('scripts/app.js', 'utf8'));
  await assert.rejects(fs.access(path.join(output, 'private.txt')));
  const shell = await fs.readFile(path.join(output, 'index.html'), 'utf8');
  assert.doesNotMatch(shell, /Text rendered only|Package Example|noindex/);
  const redirect = await fs.readFile(path.join(output, 'games/2026-10-example/index.html'), 'utf8');
  assert.match(redirect, /data-legacy-route="game\/2026-10-example"/);
  assert.doesNotMatch(redirect, /Text rendered only/);
  await fs.writeFile(path.join(output, 'obsolete.txt'), 'old package');
  await packageSite({ root, environment: 'staging' });
  await checkSite(output);
  await assert.rejects(fs.access(path.join(output, 'obsolete.txt')));
  assert.match(await fs.readFile(path.join(output, 'index.html'), 'utf8'), /noindex,nofollow/);
  assert.equal(await fs.readFile(path.join(output, 'CNAME'), 'utf8'), 'test.readingmegagames.co.uk\n');
  await packageSite({ root, environment: 'production' });
  await assert.rejects(fs.access(path.join(output, 'CNAME')));
});

test('packaging rejects unsafe outputs and missing media before replacing the previous package', async t => {
  const root = await fixtureRoot(t);
  await assert.rejects(packageSite({ root, output: '.' }), /Output must/);
  await assert.rejects(packageSite({ root, output: '../dist' }), /Output must/);
  await packageSite({ root });
  await fs.unlink(path.join(root, 'images/example.jpg'));
  await assert.rejects(packageSite({ root }), /missing image/);
  await fs.access(path.join(root, 'dist/index.html'));
});

test('legacy redirects preserve source overrides and the Code of Conduct anchor', async () => {
  const script = await fs.readFile('scripts/legacy.js', 'utf8');
  for (const [pathname, root, route, hash, expected] of [
    ['/games/2026-10-example/', '../../', 'game/2026-10-example', '', '#game/2026-10-example'],
    ['/about/', '../', 'about', '#code-of-conduct', '#about/code-of-conduct'],
    ['/upcoming/', '../', 'upcoming', '', '#upcoming']
  ]) {
    let target;
    vm.runInNewContext(script, {
      URL, document: { querySelector: () => ({ dataset: { root, legacyRoute: route } }) },
      location: { href: `https://example.com${pathname}?source=test.neon${hash}`, search: '?source=test.neon', hash, replace: value => { target = value; } }
    });
    assert.equal(target, `https://example.com/?source=test.neon${expected}`);
  }
});

test('local server serves sources with the production CSP, alternate Neon and legacy links', async t => {
  const root = await fixtureRoot(t);
  const server = createSiteServer({ root, source: 'test.neon' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(await home.text(), /id="app"/);
  const games = await fetch(`${base}/games.neon`);
  assert.match(games.headers.get('content-type'), /text\/plain/);
  assert.match(await games.text(), /Alternate Example/);
  assert.match(await (await fetch(`${base}/games/2026-10-example/`)).text(), /data-legacy-route="game\/2026-10-example"/);
  assert.equal((await fetch(`${base}/private.txt`)).status, 404);
  assert.equal((await fetch(`${base}/.git/config`)).status, 404);
  assert.equal((await fetch(`${base}/images/missing.jpg`)).status, 404);
});

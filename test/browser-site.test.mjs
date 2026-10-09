import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createGamesLoader, createRenderGate, gamesSource, routeFromHash } from '../scripts/games.js';
import { galleryPhotoSizes } from '../scripts/gallery.js';
import { parseNeon, validateGames } from '../scripts/site-lib.js';
import { renderAbout, renderGame, renderHome, renderListing } from '../scripts/views.js';
import { readGames } from '../tools/site-lib.mjs';

const content = JSON.parse(fs.readFileSync('content/site.json', 'utf8'));
const fixture = '-\nname: Example\nslug: 2026-10-example\ndate: 10 October 2026\nvenue: Reading\ndescription: **Hello** <script>alert(1)</script>\nlistImage: images/example.jpg\nbannerImage: images/example.jpg\ntickets: https://example.com/tickets\nphotos: portrait.jpg, landscape.jpg\n';
const response = text => ({ ok: true, text: async () => text });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('shares in-flight requests, revalidates on next navigation and reclassifies at 16:00 UTC', async () => {
  const request = deferred();
  let calls = 0;
  let now = new Date('2026-10-10T15:59:59Z');
  const load = createGamesLoader((source, options) => {
    assert.equal(source, 'games.neon');
    assert.equal(options.cache, 'no-cache');
    calls += 1;
    return request.promise;
  }, () => now);
  const first = load();
  const second = load();
  request.resolve(response(fixture));
  assert.equal((await first)[0].isPast, false);
  assert.equal((await second)[0].isPast, false);
  assert.equal(calls, 1);
  now = new Date('2026-10-10T16:00:00Z');
  assert.equal((await load())[0].isPast, true);
  assert.equal(calls, 2);
});

test('failed requests and malformed data can be retried without a poisoned cache', async () => {
  const results = [new Error('Offline'), { ok: false, status: 503 }, response('bad data'), response(fixture + fixture), response(fixture)];
  const load = createGamesLoader(async () => {
    const result = results.shift();
    if (result instanceof Error) throw result;
    return result;
  });
  await assert.rejects(load(), /Offline/);
  await assert.rejects(load(), /503/);
  await assert.rejects(load(), /expected/);
  await assert.rejects(load(), /duplicate slug/);
  assert.equal((await load()).length, 1);
});

test('empty source renders empty lists and retains community content', async () => {
  const load = createGamesLoader(async () => response(''));
  assert.deepEqual(await load(), []);
  assert.match(renderListing([], true), /no upcoming games/i);
  assert.match(renderListing([], false), /No past games/);
  const home = renderHome([], content, 0, false);
  assert.match(home, /Discord Server/);
  assert.match(home, /<iframe[^>]*loading="lazy"[^>]*src="https:/);
});

test('rapid navigation prevents both stale success and stale error rendering', async () => {
  const begin = createRenderGate();
  const oldRequest = deferred();
  const newRequest = deferred();
  const committed = [];
  const navigate = async request => {
    const current = begin();
    try { const result = await request; if (current()) committed.push(result); }
    catch { if (current()) committed.push('error'); }
  };
  const first = navigate(oldRequest.promise);
  const second = navigate(newRequest.promise);
  newRequest.resolve('about');
  oldRequest.resolve('old games');
  await Promise.all([first, second]);
  assert.deepEqual(committed, ['about']);
  const oldError = navigate(Promise.reject(new Error('Offline')));
  const currentPage = navigate(Promise.resolve('past'));
  await Promise.all([oldError, currentPage]);
  assert.deepEqual(committed, ['about', 'past']);
});

test('hash routes include bookmarks, conduct and malformed/unknown paths', () => {
  assert.equal(routeFromHash('').page, 'home');
  for (const page of ['home', 'past', 'upcoming', 'about']) assert.equal(routeFromHash(`#${page}`).page, page);
  assert.equal(routeFromHash('#game/2026-10-example').slug, '2026-10-example');
  assert.equal(routeFromHash('#about/code-of-conduct').conduct, true);
  for (const hash of ['#nope', '#game/%GG', '#game/../secret', '#game/']) assert.equal(routeFromHash(hash).page, 'not-found');
});

test('source overrides reject remote URLs and encoded traversal', () => {
  assert.equal(gamesSource('?source=test.neon'), 'test.neon');
  for (const source of ['https://example.com/games.neon', '../games.neon', '%2e%2e/games.neon', 'scripts/app.js']) {
    assert.throws(() => gamesSource(`?source=${encodeURIComponent(source)}`));
  }
});

test('all live content parses identically in the browser and filesystem validator', () => {
  assert.deepEqual(validateGames(parseNeon(fs.readFileSync('games.neon', 'utf8'))), readGames('games.neon'));
});

test('rendering keeps RMG details, escaping, past-only galleries and upcoming-only tickets', () => {
  const game = validateGames(parseNeon(fixture))[0];
  const past = renderGame({ ...game, isPast: true });
  assert.match(past, /<strong>Hello<\/strong>/);
  assert.match(past, /&lt;script&gt;/);
  assert.doesNotMatch(past, /<script>|>Tickets</);
  assert.match(past, /<strong>Venue:<\/strong> Reading/);
  assert.equal((past.match(/data-lightbox-src=/g) || []).length, 2);
  const upcoming = renderGame({ ...game, isPast: false });
  assert.match(upcoming, />Tickets</);
  assert.doesNotMatch(upcoming, /class="gallery"/);
  assert.match(renderAbout(content), /id="code-of-conduct"/);
  assert.match(renderAbout(content), /18 and over/);
});

test('gallery photos have equal area without changing aspect ratio at every breakpoint', () => {
  for (const [width, columns] of [[1052, 4], [720, 2], [358, 1]]) {
    const ratios = [2 / 3, 1, 4 / 3, 3, 20];
    const sizes = galleryPhotoSizes(width, columns, 9.6, ratios);
    const area = sizes[0].width * sizes[0].height;
    sizes.forEach((size, index) => {
      assert.ok(Math.abs(size.width * size.height - area) < 0.0001);
      assert.ok(Math.abs(size.width / size.height - ratios[index]) < 0.0001);
      assert.ok(size.width <= width + 0.0001);
    });
  }
  assert.deepEqual(galleryPhotoSizes(1052, 4, 10, [1])[0], galleryPhotoSizes(1052, 4, 10, [1, 1, 1, 1])[0]);
  assert.deepEqual(galleryPhotoSizes(0, 4, 10, [1]), []);
  assert.deepEqual(galleryPhotoSizes(100, 4, 10, [NaN]), []);
});

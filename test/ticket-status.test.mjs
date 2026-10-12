import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { eventTicketStatus, fetchTicketStatuses, handleTicketStatus } from '../server/ticket-status.js';
import { applyTicketStatuses, createTicketStatusLoader, STATUS_MAX_AGE, ticketEventKey } from '../scripts/ticket-status.js';
import { renderHome, renderListing } from '../scripts/views.js';
import { validateGames, parseNeon } from '../scripts/site-lib.js';

const now = Date.parse('2026-10-12T12:00:00Z');
const type = (overrides = {}) => ({ id: 'tt_1', status: 'on_sale', quantity: 6, quantity_total: 40, quantity_issued: 34, quantity_held: 0, quantity_in_baskets: 0, ...overrides });
const event = (overrides = {}) => ({ id: 'ev_1', url: 'https://www.tickettailor.com/events/7/2469346', private: 'false', status: 'published', unavailable: 'false', tickets_available: 'true', ticket_types: [type()], ticket_groups: [], total_issued_tickets: 34, total_holds: 0, ...overrides });

test('nearly sold out uses the inclusive 20% boundary, sold out requires exhausted public inventory', () => {
  for (const [quantity, expected] of [[0, 'sold_out'], [1, 'nearly_sold_out'], [8, 'nearly_sold_out'], [9, 'available']]) {
    assert.equal(eventTicketStatus(event({ ticket_types: [type({ quantity })] }), now), expected);
  }
  assert.equal(eventTicketStatus(event({ ticket_types: [type({ status: 'sold_out', quantity: 40 })] }), now), 'sold_out');
  for (const overrides of [
    { private: 'true' }, { status: 'sales_closed' }, { unavailable: 'true' },
    { tickets_available_at: now / 1000 + 60 }, { tickets_unavailable_at: now / 1000 - 60 },
    { tickets_available: 'false' }, { ticket_types: [] }, { ticket_types: [type({ quantity: null })] },
    { ticket_types: [type({ quantity_total: null })] }
  ]) assert.equal(eventTicketStatus(event(overrides), now), null);
  for (const status of ['hidden', 'unavailable', 'admin_only', 'locked']) {
    assert.equal(eventTicketStatus(event({ ticket_types: [type({ status, quantity: 0 })] }), now), null);
  }
  assert.equal(eventTicketStatus(event({ ticket_types: [type({ hide_until: { unix: now / 1000 + 60 } })] }), now), null);
  assert.equal(eventTicketStatus(event({ ticket_types: [type({ access_code: 'secret' })] }), now), null);
});

test('shared event capacity prevents double counting alternative prices, including holds and baskets', () => {
  const shared = event({
    max_tickets_sold_per_occurrence: 40, total_issued_tickets: 30, total_holds: 1,
    ticket_types: [type({ quantity: 20, quantity_in_baskets: 1 }), type({ id: 'tt_2', quantity: 20 })]
  });
  assert.equal(eventTicketStatus(shared, now), 'nearly_sold_out'); // 8 of 40, not 40 of 80.
  assert.equal(eventTicketStatus({ ...shared, total_issued_tickets: 29 }, now), 'available');
  assert.equal(eventTicketStatus({ ...shared, total_issued_tickets: 38 }, now), 'sold_out');
  assert.equal(eventTicketStatus({ ...shared, total_holds: null }, now), null);
});

test('group capacities count hidden-ticket usage and do not double subtract type inventory', () => {
  const shared = event({
    ticket_groups: [{ id: 'tg_1', max_quantity: 30, ticket_ids: ['tt_1', 'tt_2'] }],
    ticket_types: [type({ quantity: 20, quantity_total: 30, quantity_issued: 20, group_id: 'tg_1' }), type({ id: 'tt_2', status: 'hidden', quantity_issued: 3, quantity_held: 1 })]
  });
  assert.equal(eventTicketStatus(shared, now), 'nearly_sold_out'); // 6 of 30.
  assert.equal(eventTicketStatus({ ...shared, ticket_groups: [{ ...shared.ticket_groups[0], max_quantity: 24 }] }, now), 'sold_out');
  assert.equal(eventTicketStatus(event({ ticket_types: [type({ quantity: 9, quantity_held: 10, quantity_in_baskets: 10 })] }), now), 'available');
  assert.equal(eventTicketStatus({ ...shared, ticket_groups: [{ ...shared.ticket_groups[0], bundle_ids: ['bu_1'] }] }, now), null);
});

test('event URL matching accepts canonical links only', () => {
  assert.equal(ticketEventKey('https://www.tickettailor.com/events/readingmegagames/2469346/?x=1'), '2469346');
  for (const url of ['https://evil.example/events/7/2469346', 'http://tickettailor.com/events/7/2469346', 'invalid']) assert.equal(ticketEventKey(url), null);
});

test('API pagination uses fixed-origin requests and returns only listed public status', async () => {
  const calls = [];
  const pages = [
    { data: [event({ id: 'ev_private', private: 'true' })], links: { next: 'https://untrusted.example/' } },
    { data: [event(), event({ url: 'https://www.tickettailor.com/events/7/999', name: 'Private metadata', revenue: 99 })] }
  ];
  const result = await fetchTicketStatuses('test-key', new Set(['2469346']), { now, fetchFile: async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Authorization, `Basic ${btoa('test-key')}`);
    assert.equal(options.redirect, 'error');
    return Response.json(pages.shift());
  } });
  assert.equal(calls.length, 2);
  assert.match(calls[1], /^https:\/\/api.tickettailor.com\/v1\/events\?.*starting_after=ev_private/);
  assert.deepEqual(result, { checkedAt: now, statuses: { '2469346': 'nearly_sold_out' } });
});

const source = '-\nname: Example\nslug: example\ndate: 10 April 2027\ndescription: Test\nlistImage: images/faes-list.png\nbannerImage: images/faes-banner.png\ntickets: https://www.tickettailor.com/events/7/2469346\n';
const context = () => ({ request: new Request('https://readingmegagames.co.uk/api/ticket-status?ignored=1'), env: { TICKET_TAILOR_API_KEY: 'test-key', ASSETS: { fetch: async () => new Response(source) } } });

test('endpoint caches successful public snapshots; missing keys, upstream failures and stale cache fail safely', async () => {
  let saved;
  let requests = 0;
  const cache = { match: async () => saved?.clone(), put: async (key, response) => { assert.equal(key.url, 'https://readingmegagames.co.uk/api/ticket-status'); saved = response; } };
  const options = { cache, now, fetchFile: async () => { requests++; return Response.json({ data: [event()] }); } };
  const first = await handleTicketStatus(context(), options);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('access-control-allow-origin'), '*');
  assert.equal(first.headers.get('cache-control'), 'public, max-age=300');
  assert.deepEqual(await first.json(), { checkedAt: now, statuses: { '2469346': 'nearly_sold_out' } });
  await handleTicketStatus(context(), options);
  assert.equal(requests, 1);
  const expired = await handleTicketStatus(context(), { ...options, now: now + STATUS_MAX_AGE, fetchFile: async () => new Response('sensitive upstream text', { status: 401 }) });
  assert.equal(expired.status, 503);
  assert.equal(expired.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(await expired.text(), /sensitive|test-key/);
  const missing = context(); delete missing.env.TICKET_TAILOR_API_KEY;
  assert.equal((await handleTicketStatus(missing, options)).status, 503);
  const post = context(); post.request = new Request(post.request, { method: 'POST' });
  assert.equal((await handleTicketStatus(post, options)).status, 405);
});

test('browser shares requests, refreshes expired snapshots and discards failures instead of retaining stale banners', async () => {
  let time = now;
  let calls = 0;
  let failure = false;
  const load = createTicketStatusLoader(async () => {
    calls++;
    if (failure) throw new Error('Offline');
    return Response.json({ checkedAt: time, statuses: { '2469346': 'sold_out' } });
  }, () => time);
  await Promise.all([load(), load()]);
  await load();
  assert.equal(calls, 1);
  time += STATUS_MAX_AGE;
  failure = true;
  assert.deepEqual(await load(), { statuses: {} });
  failure = false;
  assert.equal((await load()).statuses['2469346'], 'sold_out');
  for (const checkedAt of [now - STATUS_MAX_AGE, now + 120000, null]) {
    const invalid = createTicketStatusLoader(async () => Response.json({ checkedAt, statuses: {} }), () => now);
    assert.deepEqual(await invalid(), { statuses: {} });
  }
});

test('banners use plain text and hide unknown or stale statuses', () => {
  const element = { dataset: { ticketStatus: '2469346' } };
  const root = { querySelectorAll: () => [element] };
  for (const [status, expected] of [['sold_out', 'Sold Out'], ['nearly_sold_out', 'Nearly sold out'], ['available', ''], ['<script>', ''], ['toString', '']]) {
    applyTicketStatuses(root, { checkedAt: now, statuses: { '2469346': status } }, now);
    assert.equal(element.textContent, expected);
    assert.equal(element.hidden, !expected);
  }
  applyTicketStatuses(root, { checkedAt: now - STATUS_MAX_AGE, statuses: { '2469346': 'sold_out' } }, now);
  assert.equal(element.hidden, true);
});

test('home shows up to three games, conditionally links to the full list, and keeps banners off past games', () => {
  const content = JSON.parse(fs.readFileSync('content/site.json', 'utf8'));
  const example = validateGames(parseNeon(source))[0];
  const games = Array.from({ length: 5 }, (_, index) => ({ ...example, slug: `game-${index}`, name: `Game ${index}`, isPast: false }));
  for (const length of [0, 1, 2, 3, 4, 5]) {
    const home = renderHome(games.slice(0, length), content, 0, false);
    assert.equal((home.match(/<article/g) || []).length, Math.min(3, length));
    assert.equal(home.includes('View all upcoming games'), length > 3);
    assert.equal(home.includes('#game/game-3'), false);
    assert.equal((home.match(/data-ticket-status=/g) || []).length, Math.min(3, length));
  }
  assert.equal((renderListing(games, true).match(/data-ticket-status=/g) || []).length, 5);
  assert.doesNotMatch(renderListing(games.map(game => ({ ...game, isPast: true })), false), /data-ticket-status/);
});

import { isPastAt, parseNeon, validateGames } from '../scripts/site-lib.js';
import { STATUS_MAX_AGE, ticketEventKey } from '../scripts/ticket-status.js';

const count = value => Number.isInteger(value) && value >= 0;
const yes = value => value === true || value === 'true';
const no = value => value === false || value === 'false';
const used = type => count(type.quantity_issued) && count(type.quantity_held) && count(type.quantity_in_baskets ?? 0)
  ? type.quantity_issued + type.quantity_held + (type.quantity_in_baskets ?? 0) : NaN;

// Quantity is already the available inventory, not quantity_total minus sales.
// Event and group caps can be lower than the sum of the individual ticket types.
export function eventTicketStatus(event, now = Date.now()) {
  if (!event || event.status !== 'published' || !no(event.private) || yes(event.unavailable)) return null;
  const seconds = Math.floor(now / 1000);
  if (event.tickets_available_at > seconds || (event.tickets_unavailable_at && event.tickets_unavailable_at <= seconds)) return null;
  const types = event.ticket_types;
  if (!Array.isArray(types) || !types.length) return null;
  const eligible = types.filter(type => ['on_sale', 'sold_out'].includes(type.status) && !type.access_code
    && !(type.hide_until?.unix > seconds) && !(type.hide_after?.unix && type.hide_after.unix <= seconds));
  if (!eligible.length) return null; // Closed, hidden and not-yet-on-sale are not sold out.
  if (eligible.some(type => !count(type.quantity) || !count(type.quantity_total))) return null;
  const available = type => type.status === 'sold_out' ? 0 : type.quantity;
  let remaining = eligible.reduce((sum, type) => sum + available(type), 0);
  let capacity = eligible.reduce((sum, type) => sum + type.quantity_total, 0);
  const grouped = new Set();
  for (const group of event.ticket_groups || []) {
    if (group.max_quantity == null) continue;
    if (!count(group.max_quantity) || group.bundle_ids?.length) return null;
    const members = types.filter(type => type.group_id === group.id || group.ticket_ids?.includes(type.id));
    const publicMembers = members.filter(type => eligible.includes(type));
    if (!publicMembers.length) continue;
    if (members.some(type => !Number.isFinite(used(type)))) return null;
    // Overlapping caps need more information; don't guess a sell-out banner.
    if (publicMembers.some(type => grouped.has(type.id))) return null;
    publicMembers.forEach(type => grouped.add(type.id));
    const groupAvailable = publicMembers.reduce((sum, type) => sum + available(type), 0);
    const groupCapacity = publicMembers.reduce((sum, type) => sum + type.quantity_total, 0);
    const groupRemaining = Math.max(0, group.max_quantity - members.reduce((sum, type) => sum + used(type), 0));
    remaining -= groupAvailable - Math.min(groupAvailable, groupRemaining);
    capacity -= groupCapacity - Math.min(groupCapacity, group.max_quantity);
  }
  if (event.max_tickets_sold_per_occurrence != null) {
    if (![event.max_tickets_sold_per_occurrence, event.total_issued_tickets, event.total_holds].every(count)
      || types.some(type => !count(type.quantity_in_baskets ?? 0))) return null;
    const baskets = types.reduce((sum, type) => sum + (type.quantity_in_baskets ?? 0), 0);
    remaining = Math.min(remaining, Math.max(0, event.max_tickets_sold_per_occurrence - event.total_issued_tickets - event.total_holds - baskets));
    capacity = Math.min(capacity, event.max_tickets_sold_per_occurrence);
  }
  if (remaining === 0) return 'sold_out';
  // Availability may be disabled for reasons unrelated to capacity.
  if (!yes(event.tickets_available)) return null;
  return capacity > 0 && remaining / capacity <= 0.2 ? 'nearly_sold_out' : 'available';
}

export async function fetchTicketStatuses(apiKey, listedKeys, { fetchFile = globalThis.fetch.bind(globalThis), now = Date.now() } = {}) {
  const statuses = {};
  if (!listedKeys.size) return { checkedAt: now, statuses };
  const query = new URLSearchParams({ status: 'published', limit: '100', 'end_at.gte': String(Math.floor(now / 1000)) });
  const seenCursors = new Set();
  const signal = AbortSignal.timeout(6500);
  for (let page = 0; page < 20; page++) {
    const response = await fetchFile(`https://api.tickettailor.com/v1/events?${query}`, {
      headers: { Accept: 'application/json', Authorization: `Basic ${btoa(apiKey)}` },
      redirect: 'error', signal
    });
    if (!response.ok) throw new Error(`Ticket Tailor returned HTTP ${response.status}`);
    const result = await response.json();
    if (!Array.isArray(result.data)) throw new Error('Invalid Ticket Tailor response');
    for (const event of result.data) {
      const key = ticketEventKey(event.url);
      if (!key || !listedKeys.has(key)) continue;
      const status = eventTicketStatus(event, now);
      if (status) statuses[key] = status;
    }
    // Use our fixed API origin, never an API-provided next URL with credentials.
    if (!result.data.length || (!result.links?.next && result.data.length < 100)) return { checkedAt: now, statuses };
    const cursor = result.data.at(-1)?.id;
    if (typeof cursor !== 'string' || seenCursors.has(cursor)) throw new Error('Invalid event pagination');
    seenCursors.add(cursor);
    query.set('starting_after', cursor);
  }
  throw new Error('Event pagination limit exceeded');
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: {
    'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-store',
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff'
  } });
}

export async function handleTicketStatus({ request, env, waitUntil = () => {} }, { fetchFile = globalThis.fetch.bind(globalThis), cache = globalThis.caches?.default, now = Date.now() } = {}) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  if (!env.TICKET_TAILOR_API_KEY) return json({ error: 'Ticket availability unavailable' }, 503);
  const cacheKey = new Request(new URL('/api/ticket-status', request.url));
  let stage = 'cache';
  try {
    const cached = await cache?.match(cacheKey);
    if (cached) {
      const data = await cached.clone().json();
      if (Number.isFinite(data.checkedAt) && now - data.checkedAt < STATUS_MAX_AGE) return cached;
    }
    stage = 'game-source';
    const source = await env.ASSETS.fetch(new Request(new URL('/games.neon', request.url)));
    if (!source.ok) throw new Error('Game source unavailable');
    const games = validateGames(parseNeon(await source.text()));
    const listedKeys = new Set(games.filter(game => !isPastAt(game.dateObj, new Date(now))).map(game => ticketEventKey(game.tickets)).filter(Boolean));
    stage = 'ticket-api';
    const snapshot = await fetchTicketStatuses(env.TICKET_TAILOR_API_KEY, listedKeys, { fetchFile, now });
    const response = json(snapshot);
    stage = 'cache-write';
    if (cache) waitUntil(cache.put(cacheKey, response.clone()).catch(() => {}));
    return response;
  } catch (error) {
    console.error('Ticket availability failed', stage, error.name);
    // No credentials, raw upstream response, private events or customer data leave this endpoint.
    return json({ error: 'Ticket availability unavailable', stage }, 503);
  }
}

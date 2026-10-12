export const STATUS_MAX_AGE = 5 * 60 * 1000;
const labels = { sold_out: 'Sold Out', nearly_sold_out: 'Nearly sold out' };

export function ticketEventKey(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['www.tickettailor.com', 'tickettailor.com'].includes(url.hostname)) return null;
    return url.pathname.match(/^\/events\/[^/]+\/(\d+)\/?$/)?.[1] || null;
  } catch { return null; }
}

export function createTicketStatusLoader(fetchFile = globalThis.fetch, now = Date.now, endpoint = '/api/ticket-status') {
  let saved;
  let pending;
  return async () => {
    if (saved && now() - saved.checkedAt < STATUS_MAX_AGE) return saved;
    if (!pending) {
      pending = (async () => {
        try {
          const response = await fetchFile(endpoint, { cache: 'no-cache', signal: AbortSignal.timeout(8000) });
          if (!response.ok) throw new Error('Ticket status unavailable');
          const data = await response.json();
          if (!Number.isFinite(data.checkedAt) || data.checkedAt > now() + 60000 || now() - data.checkedAt >= STATUS_MAX_AGE || !data.statuses || typeof data.statuses !== 'object' || Array.isArray(data.statuses)) throw new Error('Invalid ticket status');
          saved = data;
          return data;
        } catch {
          saved = undefined;
          return { statuses: {} };
        } finally { pending = undefined; }
      })();
    }
    return pending;
  };
}

export function applyTicketStatuses(root, snapshot, now = Date.now()) {
  const fresh = Number.isFinite(snapshot.checkedAt) && now - snapshot.checkedAt < STATUS_MAX_AGE && snapshot.checkedAt <= now + 60000;
  root.querySelectorAll('[data-ticket-status]').forEach(element => {
    const status = fresh ? snapshot.statuses?.[element.dataset.ticketStatus] : null;
    const label = Object.hasOwn(labels, status) ? labels[status] : '';
    element.textContent = label;
    element.className = label ? `ticket-status ticket-status--${status}` : 'ticket-status';
    element.hidden = !label;
  });
}

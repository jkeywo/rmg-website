import { setTimeout } from 'node:timers/promises';
import { ticketStatusEndpoint, STATUS_MAX_AGE } from '../scripts/ticket-status.js';

const endpoint = ticketStatusEndpoint('test.readingmegagames.co.uk');
for (let attempt = 1; attempt <= 6; attempt++) {
  try {
    const response = await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      const diagnostic = await response.json().catch(() => ({}));
      const stage = ['cache', 'game-source', 'ticket-api', 'cache-write'].includes(diagnostic.stage) ? ` (${diagnostic.stage})` : '';
      throw new Error(`HTTP ${response.status}${stage}`);
    }
    if (response.headers.get('access-control-allow-origin') !== '*') throw new Error('Missing public CORS header');
    const data = await response.json();
    if (!Number.isFinite(data.checkedAt) || Date.now() - data.checkedAt >= STATUS_MAX_AGE || !data.statuses || typeof data.statuses !== 'object') throw new Error('Invalid ticket snapshot');
    console.log(`Staging ticket endpoint verified (${Object.keys(data.statuses).length} confirmed game statuses).`);
    break;
  } catch (error) {
    if (attempt === 6) throw new Error(`Staging ticket endpoint failed: ${error.message}`);
    await setTimeout(5000);
  }
}

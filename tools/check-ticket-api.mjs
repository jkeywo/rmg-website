import { readGames } from './site-lib.mjs';
import { isPastAt } from '../scripts/site-lib.js';
import { ticketEventKey } from '../scripts/ticket-status.js';
import { fetchTicketStatuses } from '../server/ticket-status.js';

const key = process.env.TICKET_TAILOR_API_KEY;
if (!key) throw new Error('Set TICKET_TAILOR_API_KEY to check the live connection.');
const games = readGames('games.neon').filter(game => !isPastAt(game.dateObj, new Date()) && ticketEventKey(game.tickets));
const { statuses } = await fetchTicketStatuses(key, new Set(games.map(game => ticketEventKey(game.tickets))));
for (const game of games) console.log(`${game.slug}: ${statuses[ticketEventKey(game.tickets)] || 'unknown (no banner)'}`);

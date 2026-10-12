import { handleTicketStatus } from '../../server/ticket-status.js';

export function onRequest(context) {
  return handleTicketStatus(context);
}

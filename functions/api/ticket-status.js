import { handleTicketStatus } from '../../server/ticket-status.js';

export function onRequest(context) {
  return handleTicketStatus({ request: context.request, env: context.env, waitUntil: promise => context.waitUntil(promise) });
}

import { db } from '../../lib/db';

export type TicketValidationResult = {
  valid: boolean;
  reason: string;
  payload?: Record<string, unknown>;
};

export async function validateTicketToken(token: string): Promise<TicketValidationResult> {
  try {
    const raw = JSON.parse(atob(token));
    if (!raw || typeof raw.payload !== 'object' || typeof raw.signature !== 'string') {
      return { valid: false, reason: 'Ticket token is malformed.' };
    }

    const payload = raw.payload as Record<string, unknown>;
    const { verifyTicketPayload } = await import('../../lib/crypto');
    const ok = await verifyTicketPayload(payload, raw.signature);
    if (!ok) {
      return { valid: false, reason: 'Ticket signature did not match.' };
    }

    const ticketId = String(payload.ticketId ?? '');
    const ticketNumber = String(payload.ticketNumber ?? '');
    const tripNumber = String(payload.tripNumber ?? '');

    if (!ticketId || !ticketNumber || !tripNumber) {
      return { valid: false, reason: 'Ticket payload is incomplete.' };
    }

    const saved = await db.tickets.get(ticketId);
    if (!saved) {
      return { valid: false, reason: 'Ticket not found locally.' };
    }

    if (saved.ticketNumber !== ticketNumber) {
      return { valid: false, reason: 'Ticket number mismatch.' };
    }

    return {
      valid: true,
      reason: 'Ticket accepted.',
      payload: {
        ticketId: saved.id,
        ticketNumber: saved.ticketNumber,
        tripNumber: saved.tripNumber,
        from: saved.fromStopName,
        to: saved.toStopName,
        conductor: saved.conductorName,
        bus: saved.busRegistration
      }
    };
  } catch {
    return { valid: false, reason: 'Ticket token is not valid base64 JSON.' };
  }
}

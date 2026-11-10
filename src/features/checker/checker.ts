import { db } from '../../lib/db';
import { decodeSignedToken, verifyTicketPayload } from '../../lib/crypto';

export type TicketValidationResult = {
  valid: boolean;
  reason: string;
  payload?: Record<string, unknown>;
};

export async function validateTicketToken(token: string): Promise<TicketValidationResult> {
  const decoded = decodeSignedToken(token);
  if (!decoded) {
    return { valid: false, reason: 'Ticket token is not valid base64 JSON.' };
  }

  const { payload, signature } = decoded;
  const ok = await verifyTicketPayload(payload, signature);
  if (!ok) {
    return { valid: false, reason: 'Ticket signature did not match.', payload };
  }

  const ticketId = String(payload.ticketId ?? '');
  const ticketNumber = String(payload.ticketNumber ?? '');
  const tripNumber = String(payload.tripNumber ?? '');

  if (!ticketId || !ticketNumber || !tripNumber) {
    return { valid: false, reason: 'Ticket payload is incomplete.' };
  }

  const saved = await db.tickets.get(ticketId);
  if (!saved) {
    return { valid: false, reason: 'Ticket not found on this device.', payload };
  }

  if (saved.ticketNumber !== ticketNumber) {
    return { valid: false, reason: 'Ticket number mismatch.', payload };
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
      amountCents: saved.amountCents,
      paymentMethod: saved.paymentMethod,
      conductor: saved.conductorName,
      bus: saved.busRegistration
    }
  };
}

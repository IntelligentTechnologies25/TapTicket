import { db } from '../../lib/db';
import { validateSignedTicket } from './validation';
import { supabase } from '../../lib/supabase';
import { getOrCreateDeviceIdentity } from '../../lib/deviceIdentity';

export type TicketValidationResult = { valid: boolean; reason: string; payload?: Record<string, unknown> };

export async function validateTicketToken(token: string, checkerProfileId?: string): Promise<TicketValidationResult> {
  let decoded: { payload?: Record<string, unknown>; signature?: string };
  try { decoded = JSON.parse(token); } catch { return { valid: false, reason: 'Malformed ticket QR payload.' }; }
  if (!decoded.payload || typeof decoded.signature !== 'string') return { valid: false, reason: 'Ticket QR is missing signature data.' };
  const result = await validateSignedTicket(token);

  if (checkerProfileId) {
    const profile = await db.profiles.get(checkerProfileId);
    if (profile) {
      const identity = await getOrCreateDeviceIdentity(profile);
      const ticketId = String(decoded.payload.id ?? decoded.payload.ticketId ?? '');
      const ticketNumber = String(decoded.payload.ticketNumber ?? '');
      const tripId = String(decoded.payload.tripId ?? '');
      const scanId = crypto.randomUUID();
      const row = { id: scanId, trip_id: tripId, ticket_id: ticketId || null, ticket_number: ticketNumber, result: result.valid ? 'valid' : 'fake', client_scanned_at: new Date().toISOString(), checker_profile_id: profile.id, device_id: identity.id, company_id: profile.companyId };
      await db.outbox.add({ id: `scan:${scanId}`, entity: 'scan', action: 'event', payload: row as unknown as Record<string, unknown>, createdAt: Date.now(), state: 'queued', attempts: 0 });
      await db.outbox.add({ id: `audit:${scanId}`, entity: 'audit', action: 'event', payload: { id: crypto.randomUUID(), company_id: profile.companyId, actor_profile_id: profile.id, device_id: identity.id, action: 'ticket_validation', entity_type: 'ticket', entity_id: ticketId || null, details: { result: row.result, ticket_number: ticketNumber }, client_created_at: new Date().toISOString() }, createdAt: Date.now(), state: 'queued', attempts: 0 });
      if (result.valid) await db.settings.put({ key: `used-ticket:${ticketId}`, value: Date.now() });
      if (supabase && navigator.onLine) void import('../../lib/sync').then((module) => module.syncOutbox());
    }
  }
  return result;
}

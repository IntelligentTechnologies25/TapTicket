import { db } from '../../lib/db';
import { canonicalJson, getOrCreateDeviceIdentity, signDevicePayload } from '../../lib/deviceIdentity';
import { supabase } from '../../lib/supabase';

export async function signAndAuditTicket(ticket: Record<string, unknown>, profileId: string, companyId: string) {
  const profile = await db.profiles.get(profileId);
  if (!profile || !supabase) throw new Error('Authenticated conductor profile is required to sign tickets.');
  const identity = await getOrCreateDeviceIdentity(profile);
  const payload = { ...ticket, keyId: identity.id };
  const signature = await signDevicePayload(identity, payload);
  return { payload, signature, publicKey: identity.publicKey, canonical: canonicalJson(payload) };
}

export async function verifyAndAuditTicket(input: {
  payload: Record<string, unknown>;
  signature: string;
  checkerProfileId: string;
  companyId: string;
  tripId: string;
  result: 'valid' | 'fake' | 'reused' | 'voided' | 'wrong_bus' | 'wrong_route' | 'unknown_key';
}): Promise<void> {
  const profile = await db.profiles.get(input.checkerProfileId);
  if (!profile) return;
  const scanId = crypto.randomUUID();
  const scan = {
    id: scanId,
    companyId: input.companyId,
    tripId: input.tripId,
    ticketId: typeof input.payload.ticketId === 'string' ? input.payload.ticketId : null,
    ticketNumber: typeof input.payload.ticketNumber === 'string' ? input.payload.ticketNumber : null,
    checkerProfileId: profile.id,
    deviceId: String(input.payload.keyId ?? ''),
    result: input.result,
    clientScannedAt: Date.now()
  };
  await db.transaction('rw', db.outbox, async () => {
    await db.outbox.add({
      id: `scan:${scanId}`, entity: 'scan', action: 'event', payload: scan as unknown as Record<string, unknown>,
      createdAt: Date.now(), state: 'queued', attempts: 0
    });
    await db.outbox.add({
      id: `audit:${scanId}`, entity: 'audit', action: 'event',
      payload: { id: crypto.randomUUID(), companyId: input.companyId, actorProfileId: profile.id, deviceId: scan.deviceId, action: 'ticket_scan', entityType: 'ticket', entityId: scan.ticketId, details: { result: input.result, ticketNumber: scan.ticketNumber }, clientCreatedAt: Date.now() },
      createdAt: Date.now(), state: 'queued', attempts: 0
    });
  });
}

export function canonicalTicketPayload(payload: Record<string, unknown>): string {
  return canonicalJson(payload);
}

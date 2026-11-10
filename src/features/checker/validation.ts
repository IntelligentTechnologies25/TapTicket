import { db } from './db';
import { canonicalJson, verifyDevicePayload } from './deviceIdentity';
import { supabase } from './supabase';

export async function publicKeyFor(deviceId: string): Promise<string | undefined> {
  const key = `device-key:${deviceId}`;
  const cached = await db.settings.get(key);
  if (typeof cached?.value === 'string') return cached.value;
  if (!navigator.onLine || !supabase) return undefined;
  const { data, error } = await supabase.from('devices').select('signing_public_key, active').eq('id', deviceId).single();
  if (error || !data?.active || !data.signing_public_key) return undefined;
  await db.settings.put({ key, value: data.signing_public_key });
  return data.signing_public_key;
}

export async function validateSignedTicket(token: string): Promise<{ valid: boolean; reason: string; payload?: Record<string, unknown> }> {
  try {
    const decoded = JSON.parse(token) as { payload?: Record<string, unknown>; signature?: string };
    if (!decoded.payload || typeof decoded.signature !== 'string') return { valid: false, reason: 'Malformed ticket token.' };
    const payload = decoded.payload;
    const keyId = String(payload.keyId ?? '');
    const ticketId = String(payload.id ?? payload.ticketId ?? '');
    const ticketNumber = String(payload.ticketNumber ?? '');
    if (!keyId || !ticketId || !ticketNumber) return { valid: false, reason: 'Ticket is missing required identity fields.' };
    const publicKey = await publicKeyFor(keyId);
    if (!publicKey) return { valid: false, reason: 'Signing device key is not cached; connect and download trusted device keys.' };
    if (!(await verifyDevicePayload(payload, decoded.signature, publicKey))) return { valid: false, reason: 'Ticket signature is invalid.' };

    const local = await db.tickets.get(ticketId);
    if (local && local.ticketNumber !== ticketNumber) return { valid: false, reason: 'Ticket details do not match the saved record.' };
    if (supabase && navigator.onLine) {
      const { data, error } = await supabase.from('ticket_voids').select('id').eq('ticket_id', ticketId).limit(1);
      if (!error && data?.length) return { valid: false, reason: 'Ticket has been voided.' };
    }
    const previous = await db.settings.get(`used-ticket:${ticketId}`);
    if (previous) return { valid: false, reason: 'Ticket has already been used on this checker device.' };
    await db.settings.put({ key: `used-ticket:${ticketId}`, value: Date.now() });
    return { valid: true, reason: 'Signature verified; accepted once on this checker device.', payload };
  } catch {
    return { valid: false, reason: 'Ticket data could not be decoded or verified.' };
  }
}

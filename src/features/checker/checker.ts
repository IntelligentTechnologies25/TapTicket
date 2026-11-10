import { db } from '../../lib/db';
import { supabase } from '../../lib/supabase';
import { verifyDevicePayload } from '../../lib/deviceIdentity';

export type TicketValidationResult = { valid:boolean; reason:string; payload?:Record<string,unknown> };
async function trustedPublicKey(deviceId: string): Promise<string | undefined> {
  const cacheKey = `trusted-device-key:${deviceId}`;
  if (navigator.onLine && supabase) {
    const { data, error } = await supabase.from('devices').select('signing_public_key,active,company_id').eq('id',deviceId).single();
    if (!error && data?.active) {
      await db.settings.put({ key:cacheKey, value:{ publicKey:data.signing_public_key, companyId:data.company_id, fetchedAt:Date.now() } });
      return data.signing_public_key;
    }
    // Do not fall back to stale keys when the server says the key is revoked or inaccessible.
    if (!error) { await db.settings.delete(cacheKey); return undefined; }
  }
  const cached = await db.settings.get(cacheKey);
  if (cached?.value && typeof cached.value === 'object') return (cached.value as { publicKey?:string }).publicKey;
  return undefined;
}
export async function validateTicketToken(token: string, checkerProfileId?: string): Promise<TicketValidationResult> {
  let decoded: { payload?:Record<string,unknown>; signature?:string };
  try { decoded = JSON.parse(token); } catch { return { valid:false,reason:'Malformed ticket QR.' }; }
  if (!decoded.payload || typeof decoded.signature !== 'string') return { valid:false,reason:'Ticket signature data is missing.' };
  const payload = decoded.payload;
  const deviceId = String(payload.keyId ?? payload.deviceId ?? '');
  const ticketId = String(payload.id ?? payload.ticketId ?? '');
  const ticketNumber = String(payload.ticketNumber ?? '');
  if (!deviceId || !ticketId || !ticketNumber) return { valid:false,reason:'Required ticket identity is missing.' };
  const key = await trustedPublicKey(deviceId);
  if (!key || !(await verifyDevicePayload(payload,decoded.signature,key))) return { valid:false,reason:'Untrusted device key or invalid signature.' };
  const profile = checkerProfileId ? await db.profiles.get(checkerProfileId) : undefined;
  const localUsed = await db.settings.get(`used-ticket:${ticketId}`);
  if (localUsed) return { valid:false,reason:'Already scanned on this checker device.' };
  let reason = 'Signature valid; awaiting server reconciliation.';
  let result:'valid'|'voided'|'reused'|'unknown_key' = 'valid';
  if (navigator.onLine && supabase && profile) {
    const { data, error } = await supabase.functions.invoke('validate-ticket', { body:{ token, tripId:payload.tripId, scanId:crypto.randomUUID(), clientScannedAt:new Date().toISOString() } });
    if (error) return { valid:false,reason:'Online server validation failed; do not treat as boarded.' };
    result = data?.result;
    if (result !== 'valid') return { valid:false,reason:data?.reason ?? 'Server rejected ticket.',payload };
    reason = 'Signature, trip, void and duplicate checks passed by server.';
  }
  await db.settings.put({ key:`used-ticket:${ticketId}`, value:Date.now() });
  if (checkerProfileId) {
    await db.outbox.put({ id:`scan:${crypto.randomUUID()}`, entity:'scan', action:'event', payload:{ token, scanId:crypto.randomUUID(), tripId:String(payload.tripId ?? ''), clientScannedAt:new Date().toISOString(), localResult:result }, createdAt:Date.now(), state:'queued', attempts:0 });
  }
  return { valid:true,reason,payload };
}

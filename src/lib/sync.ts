import { db, type LocalProfile, type OutboxItem } from './db';
import { supabase } from './supabase';
import { getOrCreateDeviceIdentity } from './deviceIdentity';

const BASE_DELAY = 2_000;
const MAX_DELAY = 5 * 60_000;
let running = false;
const uuid = (value: unknown, label: string) => {
  const text = String(value ?? '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw new Error(`${label} must be a provisioned server UUID.`);
  return text;
};
async function profileAndDevice(): Promise<{ profile: LocalProfile; deviceId: string }> {
  if (!supabase) throw new Error('Backend is not configured.');
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session) throw new Error('Sign in before syncing.');
  const profile = await db.profiles.get(sessionData.session.user.id);
  if (!profile?.active) throw new Error('No active cached profile for the signed-in user.');
  const identity = await getOrCreateDeviceIdentity(profile);
  const challenge = crypto.randomUUID();
  const { signDevicePayload } = await import('./deviceIdentity');
  const proof = await signDevicePayload(identity, { challenge, deviceId: identity.id, profileId: profile.id });
  const { error } = await supabase.functions.invoke('register-device', { body: { deviceId: identity.id, deviceCode: identity.code, publicKey: identity.publicKey, challenge, proof } });
  if (error) throw error;
  return { profile, deviceId: identity.id };
}
function fromTrip(payload: Record<string, unknown>, deviceId: string) {
  return { id: uuid(payload.id,'trip id'), company_id: uuid(payload.companyId,'company id'), route_id: uuid(payload.routeId,'route id'), device_id: deviceId, conductor_profile_id: uuid(payload.conductorId,'conductor id'), trip_number: String(payload.tripNumber), route_name: String(payload.routeName), bus_registration: String(payload.busRegistration), driver_name: String(payload.driverName), conductor_mobile: String(payload.conductorMobile), started_at: new Date(Number(payload.startedAt)).toISOString(), status: 'active' };
}
async function upload(item: OutboxItem, deviceId: string, profile: LocalProfile): Promise<void> {
  if (!supabase) throw new Error('Backend is not configured.');
  const p = item.payload;
  if (item.entity === 'trip') {
    const { error } = await supabase.from('trips').upsert(fromTrip(p,deviceId), { onConflict:'id', ignoreDuplicates:true });
    if (error) throw error;
    return;
  }
  if (item.entity === 'ticket') {
    if (String(p.deviceId) !== deviceId || !p.signedPayload || typeof p.signature !== 'string') throw new Error('Ticket does not contain this enrolled device signature.');
    const { error } = await supabase.functions.invoke('ingest-ticket', { body: { ticket: p } });
    if (error) throw error;
    return;
  }
  if (item.entity === 'trip_end') {
    const tripId = uuid(p.tripId,'trip id');
    const { error } = await supabase.from('trips').update({ status:'ended', ended_at:new Date(Number(p.endedAt)).toISOString() }).eq('id',tripId).eq('conductor_profile_id',profile.id);
    if (error) throw error;
    return;
  }
  if (item.entity === 'scan') {
    const { error } = await supabase.functions.invoke('validate-ticket', { body: { token:p.token, scanId:p.scanId, tripId:p.tripId, clientScannedAt:p.clientScannedAt } });
    if (error) throw error;
    return;
  }
  throw new Error(`Unknown outbox event ${item.entity}; retained for operator review.`);
}
export async function syncOutbox(): Promise<void> {
  if (running || !supabase || !navigator.onLine) return;
  running = true;
  try {
    const { profile, deviceId } = await profileAndDevice();
    const pending = await db.outbox.orderBy('createdAt').toArray();
    for (const item of pending) {
      const due = item.lastAttemptAt ? item.lastAttemptAt + Math.min(MAX_DELAY, BASE_DELAY * (2 ** item.attempts)) : 0;
      if (Date.now() < due) break;
      await db.outbox.update(item.id,{ state:'sending', lastAttemptAt:Date.now(), lastError:undefined });
      try {
        await upload(item,deviceId,profile);
        await db.outbox.delete(item.id);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Sync failed';
        await db.outbox.update(item.id,{ state:'queued', attempts:item.attempts+1, lastAttemptAt:Date.now(), lastError:message.slice(0,500) });
        break;
      }
    }
  } finally { running = false; }
}
export function startSync(): () => void {
  const run = () => { void syncOutbox(); };
  window.addEventListener('online',run);
  const timer = window.setInterval(run,15_000);
  run();
  return () => { window.removeEventListener('online',run); window.clearInterval(timer); };
}
export async function queuedCount(): Promise<number> { return db.outbox.count(); }

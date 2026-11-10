import { db, type TicketRecord } from './db';
import { supabase } from './supabase';
import { getOrCreateDeviceIdentity } from './deviceIdentity';

const RETRY_BASE_MS = 1500;
const RETRY_MAX_MS = 5 * 60_000;
let running = false;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function requiredUuid(value: string, label: string): string {
  if (!isUuid(value)) throw new Error(`${label} is not a server UUID; refresh company reference data before syncing.`);
  return value;
}

async function registerDevice(): Promise<string> {
  const profile = await db.profiles.toCollection().first();
  if (!profile || !supabase) throw new Error('Authenticated profile/backend required.');
  const identity = await getOrCreateDeviceIdentity(profile);
  const { error } = await supabase.rpc('register_device', {
    p_device_id: identity.id,
    p_device_code: identity.code,
    p_signing_public_key: identity.publicKey
  });
  if (error) throw error;
  return identity.id;
}

function mapTrip(payload: Record<string, unknown>, deviceId: string) {
  return {
    id: requiredUuid(String(payload.id), 'trip id'),
    company_id: requiredUuid(String(payload.companyId), 'company id'),
    route_id: requiredUuid(String(payload.routeId), 'route id'),
    device_id: deviceId,
    conductor_profile_id: requiredUuid(String(payload.conductorId), 'conductor id'),
    trip_number: String(payload.tripNumber),
    route_name: String(payload.routeName),
    bus_registration: String(payload.busRegistration),
    driver_name: String(payload.driverName),
    conductor_mobile: String(payload.conductorMobile),
    started_at: new Date(Number(payload.startedAt)).toISOString(),
    status: 'active'
  };
}

function mapTicket(payload: Record<string, unknown>, deviceId: string) {
  return {
    id: requiredUuid(String(payload.id), 'ticket id'),
    company_id: requiredUuid(String(payload.companyId), 'company id'),
    trip_id: requiredUuid(String(payload.tripId), 'trip id'),
    device_id: deviceId,
    sequence_number: Number(payload.sequenceNumber),
    ticket_number: String(payload.ticketNumber),
    from_stop_id: requiredUuid(String(payload.fromStopId), 'from-stop id'),
    from_stop_name: String(payload.fromStopName),
    to_stop_id: requiredUuid(String(payload.toStopId), 'to-stop id'),
    to_stop_name: String(payload.toStopName),
    fare_type: String(payload.fareType),
    amount_cents: Number(payload.amountCents),
    payment_method: String(payload.paymentMethod),
    cash_tendered_cents: payload.cashTenderedCents == null ? null : Number(payload.cashTenderedCents),
    change_cents: Number(payload.changeCents),
    ecocash_reference: payload.ecocashReference == null ? null : String(payload.ecocashReference),
    signed_payload: payload.signedPayload,
    signature: String(payload.signature),
    client_created_at: new Date(Number(payload.createdAt)).toISOString()
  };
}

async function upload(item: { entity: string; payload: Record<string, unknown> }, deviceId: string) {
  if (!supabase) throw new Error('Supabase not configured.');
  if (item.entity === 'trip') {
    const row = mapTrip(item.payload, deviceId);
    const { error } = await supabase.from('trips').upsert(row, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
    return;
  }
  if (item.entity === 'ticket') {
    const row = mapTicket(item.payload, deviceId);
    const { error } = await supabase.from('tickets').upsert(row, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
    return;
  }
  if (item.entity === 'trip_end') {
    const tripId = requiredUuid(String(item.payload.tripId), 'trip id');
    const { error } = await supabase.from('trips').update({ status: 'ended', ended_at: new Date(Number(item.payload.endedAt)).toISOString() }).eq('id', tripId);
    if (error) throw error;
    return;
  }
  throw new Error(`Unsupported queued event type: ${item.entity}`);
}

export async function syncOutbox(): Promise<void> {
  if (running || !navigator.onLine || !supabase) return;
  running = true;
  try {
    const session = await supabase.auth.getSession();
    if (session.error || !session.data.session) return;
    const profile = await db.profiles.toCollection().first();
    if (!profile?.active) return;
    const deviceId = await registerDevice();
    const pending = await db.outbox.orderBy('createdAt').toArray();
    for (const item of pending) {
      const retryAt = item.lastAttemptAt ? item.lastAttemptAt + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** item.attempts)) : 0;
      if (Date.now() < retryAt) break;
      await db.outbox.update(item.id, { state: 'sending', lastAttemptAt: Date.now() });
      try {
        await upload(item, deviceId);
        await db.outbox.delete(item.id);
      } catch (cause) {
        await db.outbox.update(item.id, { state: 'queued', attempts: item.attempts + 1, lastAttemptAt: Date.now() });
        console.warn('TapTicket sync deferred; event remains queued.', cause);
        break;
      }
    }
  } finally {
    running = false;
  }
}

export function startSync(): () => void {
  const run = () => void syncOutbox();
  window.addEventListener('online', run);
  const timer = window.setInterval(run, 15_000);
  run();
  return () => { window.removeEventListener('online', run); window.clearInterval(timer); };
}

export async function queuedCount(): Promise<number> {
  return db.outbox.count();
}

export function asTicket(payload: Record<string, unknown>): TicketRecord | null {
  return payload as unknown as TicketRecord;
}

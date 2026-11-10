import { db, type FareRoute, type FareType, type OutboxItem, type PaymentMethod, type TicketRecord, type TripRecord } from '../../lib/db';
import { getOrCreateDeviceIdentity, signDevicePayload } from '../../lib/deviceIdentity';

const sampleCompanyRoute = (companyId: string): FareRoute => ({
  id: 'demo-masvingo-gweru', name: 'Masvingo – Gweru (sample)',
  stops: [
    { id: 'demo-masvingo', name: 'Masvingo', sequence: 1 },
    { id: 'demo-mvuma', name: 'Mvuma', sequence: 2 },
    { id: 'demo-gweru', name: 'Gweru', sequence: 3 }
  ],
  faresCents: {
    'demo-masvingo|demo-mvuma': { adult: 500, child: 250 },
    'demo-mvuma|demo-masvingo': { adult: 500, child: 250 },
    'demo-mvuma|demo-gweru': { adult: 500, child: 250 },
    'demo-gweru|demo-mvuma': { adult: 500, child: 250 },
    'demo-masvingo|demo-gweru': { adult: 1000, child: 500 },
    'demo-gweru|demo-masvingo': { adult: 1000, child: 500 }
  }, sampleOnly: true
});

export async function loadConductorRoute(companyId: string): Promise<FareRoute | undefined> {
  const key = `conductor-route:${companyId}`;
  const snapshot = await db.references.get(key);
  if (snapshot?.value && typeof snapshot.value === 'object') return snapshot.value as FareRoute;
  if (import.meta.env.DEV) {
    const route = sampleCompanyRoute(companyId);
    await db.references.put({ key, companyId, version: 1, value: route, downloadedAt: Date.now() });
    return route;
  }
  return undefined;
}

function dateCode(date = new Date()): string { return `${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`; }
async function incrementSetting(key: string): Promise<number> {
  const current = await db.settings.get(key);
  const value = Number(current?.value ?? 0) + 1;
  await db.settings.put({ key, value });
  return value;
}
function outboxRow(id: string, entity: string, payload: object, createdAt: number): OutboxItem {
  return { id, entity, action: 'insert', payload: payload as Record<string, unknown>, createdAt, state: 'queued', attempts: 0 };
}

export async function getActiveTrip(companyId: string): Promise<TripRecord | undefined> {
  return db.trips.where('[companyId+status]').equals([companyId, 'active']).first();
}

export async function startLocalTrip(input: { companyId: string; route: FareRoute; conductorId: string; conductorName: string; conductorMobile: string; busRegistration: string; driverName: string }): Promise<TripRecord> {
  const registration = input.busRegistration.trim().toUpperCase();
  const driver = input.driverName.trim();
  const mobile = input.conductorMobile.trim();
  if (!registration || !driver || !mobile) throw new Error('Enter bus registration, driver name, and conductor mobile.');
  if (await getActiveTrip(input.companyId)) throw new Error('End the active trip before starting another.');
  const deviceCode = await (async () => {
    const profile = await db.profiles.get(input.conductorId);
    if (!profile) throw new Error('Conductor profile is unavailable.');
    return (await getOrCreateDeviceIdentity(profile)).code;
  })();
  return db.transaction('rw', db.trips, db.settings, db.outbox, async () => {
    const now = Date.now();
    const n = await incrementSetting(`trip-sequence:${input.companyId}:${dateCode()}`);
    const trip: TripRecord = {
      id: crypto.randomUUID(), companyId: input.companyId, routeId: input.route.id, routeName: input.route.name,
      tripNumber: `TRIP-${dateCode()}-${String(n).padStart(4, '0')}`, busRegistration: registration, driverName: driver,
      conductorId: input.conductorId, conductorName: input.conductorName, conductorMobile: mobile, startedAt: now, status: 'active'
    };
    await db.trips.add(trip);
    await db.outbox.add(outboxRow(`trip:${trip.id}`, 'trip', trip, now));
    return trip;
  });
}

export async function endLocalTrip(trip: TripRecord): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', db.trips, db.outbox, async () => {
    await db.trips.put({ ...trip, status: 'ended' });
    await db.outbox.add(outboxRow(`trip-end:${trip.id}`, 'trip_end', { tripId: trip.id, companyId: trip.companyId, endedAt: now }, now));
  });
}

export function calculateFare(route: FareRoute, fromId: string, toId: string, type: FareType, luggageCents = 0): number {
  if (fromId === toId) return 0;
  if (type === 'luggage') return luggageCents;
  return route.faresCents[`${fromId}|${toId}`]?.[type] ?? 0;
}

export async function issueLocalTicket(input: { trip: TripRecord; from: FareRoute['stops'][number]; to: FareRoute['stops'][number]; fareType: FareType; amountCents: number; paymentMethod: PaymentMethod; cashTenderedCents: number; ecocashReference: string }): Promise<TicketRecord> {
  if (input.from.id === input.to.id) throw new Error('From and To must be different stops.');
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new Error('Fare must be greater than $0.00.');
  const ref = input.ecocashReference.trim();
  if (input.paymentMethod === 'ecocash' && !ref) throw new Error('Enter the EcoCash reference.');
  if (input.paymentMethod === 'cash' && (!Number.isSafeInteger(input.cashTenderedCents) || input.cashTenderedCents < input.amountCents)) throw new Error('Cash tendered must cover the fare.');

  const profile = await db.profiles.get(input.trip.conductorId);
  if (!profile) throw new Error('Conductor profile is unavailable on this device.');
  const identity = await getOrCreateDeviceIdentity(profile);
  const now = Date.now();
  const sequence = await db.transaction('rw', db.settings, async () => incrementSetting(`ticket-sequence:${identity.id}`));
  const id = crypto.randomUUID();
  const unsigned = {
    id, tripId: input.trip.id, companyId: input.trip.companyId, ticketNumber: `${identity.code}-${dateCode()}-${String(sequence).padStart(6, '0')}`,
    deviceId: identity.id, deviceCode: identity.code, sequenceNumber: sequence, fromStopId: input.from.id, fromStopName: input.from.name,
    toStopId: input.to.id, toStopName: input.to.name, fareType: input.fareType, amountCents: input.amountCents,
    paymentMethod: input.paymentMethod, cashTenderedCents: input.paymentMethod === 'cash' ? input.cashTenderedCents : null,
    changeCents: input.paymentMethod === 'cash' ? input.cashTenderedCents - input.amountCents : 0,
    ecocashReference: input.paymentMethod === 'ecocash' ? ref : null, tripNumber: input.trip.tripNumber,
    busRegistration: input.trip.busRegistration, conductorName: input.trip.conductorName,
    conductorMobile: input.trip.conductorMobile, driverName: input.trip.driverName, createdAt: now, keyId: identity.id
  };
  const signature = await signDevicePayload(identity, unsigned);
  const ticket = { ...unsigned, signedPayload: unsigned, signature } as TicketRecord;
  await db.transaction('rw', db.tickets, db.outbox, async () => {
    await db.tickets.add(ticket);
    await db.outbox.add(outboxRow(`ticket:${ticket.id}`, 'ticket', ticket, now));
  });
  return ticket;
}

export async function listTripTickets(tripId: string): Promise<TicketRecord[]> { return db.tickets.where('tripId').equals(tripId).sortBy('createdAt'); }
export async function queuedCount(): Promise<number> { return db.outbox.where('state').equals('queued').count(); }

import { db, type FareRoute, type FareType, type LocalSetting, type OutboxItem, type PaymentMethod, type TicketRecord, type TripRecord } from '../../lib/db';

const sampleCompanyRoute = (companyId: string): FareRoute => ({
  id: 'demo-masvingo-gweru',
  name: 'Masvingo – Gweru (sample)',
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
  },
  sampleOnly: true
});

export async function loadConductorRoute(companyId: string): Promise<FareRoute | undefined> {
  const key = `conductor-route:${companyId}`;
  let snapshot = await db.references.get(key);
  if (!snapshot && import.meta.env.DEV) {
    const route = sampleCompanyRoute(companyId);
    await db.references.put({ key, companyId, version: 1, value: route, downloadedAt: Date.now() });
    snapshot = await db.references.get(key);
  }
  return snapshot?.value as FareRoute | undefined;
}

function localDateCode(date = new Date()): string {
  return `${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

async function incrementSetting(key: string): Promise<number> {
  const current = await db.settings.get(key);
  const value = Number(current?.value ?? 0) + 1;
  await db.settings.put({ key, value });
  return value;
}

export async function getDeviceCode(): Promise<string> {
  const saved = await db.settings.get('ticket-device-code');
  if (typeof saved?.value === 'string') return saved.value;
  const value = crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  await db.settings.put({ key: 'ticket-device-code', value });
  return value;
}

function outboxRow(id: string, entity: string, payload: object, createdAt: number): OutboxItem {
  return { id, entity, action: 'insert', payload: payload as Record<string, unknown>, createdAt, state: 'queued', attempts: 0 };
}

export async function getActiveTrip(companyId: string): Promise<TripRecord | undefined> {
  return db.trips.where('[companyId+status]').equals([companyId, 'active']).first();
}

export async function startLocalTrip(input: {
  companyId: string;
  route: FareRoute;
  conductorId: string;
  conductorName: string;
  conductorMobile: string;
  busRegistration: string;
  driverName: string;
}): Promise<TripRecord> {
  const registration = input.busRegistration.trim().toUpperCase();
  const driver = input.driverName.trim();
  const mobile = input.conductorMobile.trim();
  if (!registration || !driver || !mobile) throw new Error('Enter bus registration, driver name, and conductor mobile.');
  if (await getActiveTrip(input.companyId)) throw new Error('End the active trip before starting another.');

  return db.transaction('rw', db.trips, db.settings, db.outbox, async () => {
    const now = Date.now();
    const tripSequence = await incrementSetting(`trip-sequence:${input.companyId}:${localDateCode()}`);
    const trip: TripRecord = {
      id: crypto.randomUUID(), companyId: input.companyId, routeId: input.route.id,
      routeName: input.route.name, tripNumber: `TRIP-${localDateCode()}-${String(tripSequence).padStart(4, '0')}`,
      busRegistration: registration, driverName: driver, conductorId: input.conductorId,
      conductorName: input.conductorName, conductorMobile: mobile, startedAt: now, status: 'active'
    };
    await db.trips.add(trip);
    await db.outbox.add(outboxRow(`trip:${trip.id}`, 'trip', trip, now));
    return trip;
  });
}

export async function endLocalTrip(trip: TripRecord): Promise<void> {
  const ended = { ...trip, status: 'ended' as const };
  const now = Date.now();
  await db.transaction('rw', db.trips, db.outbox, async () => {
    await db.trips.put(ended);
    await db.outbox.add(outboxRow(`trip-end:${trip.id}`, 'trip_end', { tripId: trip.id, companyId: trip.companyId, endedAt: now }, now));
  });
}

export function calculateFare(route: FareRoute, fromId: string, toId: string, type: FareType, luggageCents = 0): number {
  if (fromId === toId) return 0;
  if (type === 'luggage') return luggageCents;
  const fare = route.faresCents[`${fromId}|${toId}`];
  return fare ? fare[type] : 0;
}

export async function issueLocalTicket(input: {
  trip: TripRecord;
  from: FareRoute['stops'][number];
  to: FareRoute['stops'][number];
  fareType: FareType;
  amountCents: number;
  paymentMethod: PaymentMethod;
  cashTenderedCents: number;
  ecocashReference: string;
}): Promise<TicketRecord> {
  if (input.from.id === input.to.id) throw new Error('From and To must be different stops.');
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new Error('Fare must be greater than $0.00.');
  const reference = input.ecocashReference.trim();
  if (input.paymentMethod === 'ecocash' && !reference) throw new Error('Enter the EcoCash reference.');
  if (input.paymentMethod === 'cash' && (!Number.isSafeInteger(input.cashTenderedCents) || input.cashTenderedCents < input.amountCents)) {
    throw new Error('Cash tendered must cover the fare.');
  }

  return db.transaction('rw', db.tickets, db.settings, db.outbox, async () => {
    const now = Date.now();
    const deviceId = await getDeviceCode();
    const sequence = await incrementSetting(`ticket-sequence:${deviceId}`);
    const ticket: TicketRecord = {
      id: crypto.randomUUID(), tripId: input.trip.id, companyId: input.trip.companyId,
      ticketNumber: `${deviceId}-${localDateCode()}-${String(sequence).padStart(6, '0')}`,
      deviceId, sequenceNumber: sequence, fromStopId: input.from.id, fromStopName: input.from.name,
      toStopId: input.to.id, toStopName: input.to.name, fareType: input.fareType,
      amountCents: input.amountCents, paymentMethod: input.paymentMethod,
      cashTenderedCents: input.paymentMethod === 'cash' ? input.cashTenderedCents : null,
      changeCents: input.paymentMethod === 'cash' ? input.cashTenderedCents - input.amountCents : 0,
      ecocashReference: input.paymentMethod === 'ecocash' ? reference : null,
      tripNumber: input.trip.tripNumber, busRegistration: input.trip.busRegistration,
      conductorName: input.trip.conductorName, conductorMobile: input.trip.conductorMobile,
      driverName: input.trip.driverName, createdAt: now
    };
    await db.tickets.add(ticket);
    await db.outbox.add(outboxRow(`ticket:${ticket.id}`, 'ticket', ticket, now));
    return ticket;
  });
}

export async function listTripTickets(tripId: string): Promise<TicketRecord[]> {
  return db.tickets.where('tripId').equals(tripId).sortBy('createdAt');
}

export async function queuedCount(): Promise<number> {
  return db.outbox.where('state').equals('queued').count();
}

export type { LocalSetting };

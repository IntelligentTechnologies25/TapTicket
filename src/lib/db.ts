import Dexie, { type Table } from 'dexie';

export type AppRole = 'conductor' | 'checker' | 'admin' | 'owner';
export type OutboxState = 'queued' | 'sending';
export type FareType = 'adult' | 'child' | 'luggage';
export type PaymentMethod = 'cash' | 'ecocash';

export interface LocalProfile {
  id: string; companyId: string; role: AppRole; displayName: string;
  phone: string | null; email: string | null; active: boolean; cachedAt: number;
}
export interface OutboxItem {
  id: string; entity: string; action: 'insert' | 'event'; payload: Record<string, unknown>;
  createdAt: number; state: OutboxState; attempts: number; lastAttemptAt?: number; lastError?: string;
}
export interface ReferenceSnapshot { key: string; companyId: string; version: number; value: unknown; downloadedAt: number; }
export interface LocalSetting { key: string; value: unknown; }
export interface RouteStop { id: string; name: string; sequence: number; }
export interface FareRoute {
  id: string; name: string; stops: RouteStop[];
  faresCents: Record<string, { adult: number; child: number; luggage?: number }>;
  sampleOnly?: boolean;
}
export interface TripRecord {
  id: string; companyId: string; routeId: string; routeName: string; tripNumber: string;
  busRegistration: string; driverName: string; conductorId: string; conductorName: string;
  conductorMobile: string; startedAt: number; status: 'active' | 'ended';
}
export interface TicketRecord {
  id: string; tripId: string; companyId: string; ticketNumber: string; deviceId: string; deviceCode?: string;
  sequenceNumber: number; fromStopId: string; fromStopName: string; toStopId: string; toStopName: string;
  fareType: FareType; amountCents: number; paymentMethod: PaymentMethod; cashTenderedCents: number | null;
  changeCents: number; ecocashReference: string | null; tripNumber: string; busRegistration: string;
  conductorName: string; conductorMobile: string; driverName: string; createdAt: number;
  keyId?: string; signedPayload?: Record<string, unknown>; signature?: string;
}

class TapTicketDatabase extends Dexie {
  profiles!: Table<LocalProfile, string>; outbox!: Table<OutboxItem, string>;
  references!: Table<ReferenceSnapshot, string>; settings!: Table<LocalSetting, string>;
  trips!: Table<TripRecord, string>; tickets!: Table<TicketRecord, string>;
  constructor() {
    super('tapticket-local');
    this.version(1).stores({ profiles: '&id, companyId, role, active', outbox: '&id, entity, state, createdAt', references: '&key, companyId, version, downloadedAt', settings: '&key' });
    this.version(2).stores({ profiles: '&id, companyId, role, active', outbox: '&id, entity, state, createdAt', references: '&key, companyId, version, downloadedAt', settings: '&key', trips: '&id, [companyId+status], routeId, tripNumber, status, startedAt', tickets: '&id, tripId, ticketNumber, createdAt, companyId' });
  }
}
export const db = new TapTicketDatabase();
export async function enqueueLocalEvent(entity: string, payload: Record<string, unknown>, action: OutboxItem['action'] = 'event'): Promise<OutboxItem> {
  const item: OutboxItem = { id: crypto.randomUUID(), entity, action, payload, createdAt: Date.now(), state: 'queued', attempts: 0 };
  await db.outbox.add(item);
  return item;
}

import Dexie, { type Table } from 'dexie';

export type AppRole = 'conductor' | 'checker' | 'admin' | 'owner';
export type OutboxState = 'queued' | 'sending';

export interface LocalProfile {
  id: string;
  companyId: string;
  role: AppRole;
  displayName: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  cachedAt: number;
}

export interface OutboxItem {
  id: string;
  entity: string;
  action: 'insert' | 'event';
  payload: Record<string, unknown>;
  createdAt: number;
  state: OutboxState;
  attempts: number;
  lastAttemptAt?: number;
}

export interface ReferenceSnapshot {
  key: string;
  companyId: string;
  version: number;
  value: unknown;
  downloadedAt: number;
}

export interface LocalSetting {
  key: string;
  value: unknown;
}

class TapTicketDatabase extends Dexie {
  profiles!: Table<LocalProfile, string>;
  outbox!: Table<OutboxItem, string>;
  references!: Table<ReferenceSnapshot, string>;
  settings!: Table<LocalSetting, string>;

  constructor() {
    super('tapticket-local');
    this.version(1).stores({
      profiles: '&id, companyId, role, active',
      outbox: '&id, entity, state, createdAt',
      references: '&key, companyId, version, downloadedAt',
      settings: '&key'
    });
  }
}

export const db = new TapTicketDatabase();

export async function enqueueLocalEvent(
  entity: string,
  payload: Record<string, unknown>,
  action: OutboxItem['action'] = 'event'
): Promise<OutboxItem> {
  const item: OutboxItem = {
    id: crypto.randomUUID(),
    entity,
    action,
    payload,
    createdAt: Date.now(),
    state: 'queued',
    attempts: 0
  };
  await db.outbox.add(item);
  return item;
}

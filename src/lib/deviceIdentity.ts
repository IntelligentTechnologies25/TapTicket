import { db, type LocalProfile } from './db';

export interface DeviceIdentity {
  id: string;
  code: string;
  profileId: string;
  companyId: string;
  publicKey: string;
  privateKey: CryptoKey;
}

const encoder = new TextEncoder();
function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function getOrCreateDeviceIdentity(profile: LocalProfile): Promise<DeviceIdentity> {
  const stored = await db.settings.get('device-identity');
  if (stored?.value && typeof stored.value === 'object') {
    const value = stored.value as DeviceIdentity;
    if (value.profileId === profile.id && value.companyId === profile.companyId && value.privateKey && value.publicKey && value.id) return value;
    throw new Error('This device is enrolled to another account. Sign out and use a separate browser profile/device.');
  }

  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' } as Algorithm, false, ['sign', 'verify']) as CryptoKeyPair;
  const publicBytes = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  const code = crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  const identity: DeviceIdentity = {
    id: crypto.randomUUID(), code, profileId: profile.id, companyId: profile.companyId,
    publicKey: base64(publicBytes), privateKey: pair.privateKey
  };
  // CryptoKey is stored as a structured-cloneable, non-exportable key in IndexedDB. No raw private bytes enter JS storage.
  await db.settings.put({ key: 'device-identity', value: identity });
  return identity;
}

export async function signDevicePayload(identity: DeviceIdentity, payload: Record<string, unknown>): Promise<string> {
  const bytes = encoder.encode(canonicalJson(payload));
  const signature = await crypto.subtle.sign({ name: 'Ed25519' } as Algorithm, identity.privateKey, bytes);
  return base64(new Uint8Array(signature));
}

export function canonicalJson(value: Record<string, unknown>): string {
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sort(child)]));
    }
    return item;
  };
  return JSON.stringify(sort(value));
}

export async function verifyDevicePayload(payload: Record<string, unknown>, signatureBase64: string, publicKeyBase64: string): Promise<boolean> {
  try {
    const binary = atob(publicKeyBase64);
    const publicBytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const signatureBinary = atob(signatureBase64);
    const signature = Uint8Array.from(signatureBinary, (char) => char.charCodeAt(0));
    const publicKey = await crypto.subtle.importKey('spki', publicBytes, { name: 'Ed25519' } as Algorithm, true, ['verify']);
    return crypto.subtle.verify({ name: 'Ed25519' } as Algorithm, publicKey, signature, encoder.encode(canonicalJson(payload)));
  } catch {
    return false;
  }
}

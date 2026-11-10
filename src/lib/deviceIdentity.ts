import { db } from './db';

export interface DeviceIdentity {
  id: string; code: string; profileId: string; companyId: string; publicKey: string; privateKey: CryptoKey;
}
const encoder = new TextEncoder();
function toBase64(bytes: Uint8Array): string {
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary);
}
export function canonicalJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a],[b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child)]));
    return item;
  };
  return JSON.stringify(normalize(value));
}
export async function getOrCreateDeviceIdentity(profile: { id: string; companyId: string }): Promise<DeviceIdentity> {
  const record = await db.settings.get('device-identity');
  if (record?.value && typeof record.value === 'object') {
    const stored = record.value as DeviceIdentity;
    if (stored.profileId !== profile.id || stored.companyId !== profile.companyId) throw new Error('This browser device is enrolled to another account.');
    if (!stored.privateKey || stored.privateKey.extractable || !stored.publicKey || !stored.id) throw new Error('Stored device key is invalid; re-enroll this device.');
    return stored;
  }
  if (!crypto.subtle || !globalThis.isSecureContext) throw new Error('Device signing requires a supported browser in a secure context (HTTPS).');
  let pair: CryptoKeyPair;
  try { pair = await crypto.subtle.generateKey({ name: 'Ed25519' } as Algorithm, false, ['sign','verify']) as CryptoKeyPair; }
  catch { throw new Error('This browser does not support Ed25519 WebCrypto; use a supported secure browser.'); }
  const publicKey = toBase64(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)));
  const identity: DeviceIdentity = { id: crypto.randomUUID(), code: crypto.randomUUID().replaceAll('-','').slice(0,8).toUpperCase(), profileId: profile.id, companyId: profile.companyId, publicKey, privateKey: pair.privateKey };
  await db.settings.put({ key: 'device-identity', value: identity });
  return identity;
}
export async function signDevicePayload(identity: DeviceIdentity, payload: Record<string, unknown>): Promise<string> {
  const signature = await crypto.subtle.sign({ name: 'Ed25519' } as Algorithm, identity.privateKey, encoder.encode(canonicalJson(payload)));
  return toBase64(new Uint8Array(signature));
}
export async function verifyDevicePayload(payload: Record<string, unknown>, signatureBase64: string, publicKeyBase64: string): Promise<boolean> {
  try {
    const publicKey = await crypto.subtle.importKey('spki', Uint8Array.from(atob(publicKeyBase64), c => c.charCodeAt(0)), { name: 'Ed25519' } as Algorithm, false, ['verify']);
    const signature = Uint8Array.from(atob(signatureBase64), c => c.charCodeAt(0));
    return crypto.subtle.verify({ name: 'Ed25519' } as Algorithm, publicKey, signature, encoder.encode(canonicalJson(payload)));
  } catch { return false; }
}

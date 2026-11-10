import { db } from './db';

function byteArrayToBase64(data: Uint8Array): string {
  let binary = '';
  data.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToUint8Array(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function getSigningKey(): Promise<CryptoKey> {
  const record = await db.settings.get('ticket-signing-key');
  if (record && typeof record.value === 'string') {
    const bytes = base64ToUint8Array(record.value);
    return crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  }

  const key = await crypto.subtle.generateKey(
    { name: 'HMAC', hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
  const exported = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  await db.settings.put({ key: 'ticket-signing-key', value: byteArrayToBase64(exported) });
  return key;
}

export async function signTicketPayload(payload: Record<string, unknown>): Promise<string> {
  const key = await getSigningKey();
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const signature = await crypto.subtle.sign('HMAC', key, encoded);
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyTicketPayload(payload: Record<string, unknown>, signature: string): Promise<boolean> {
  const key = await getSigningKey();
  const expected = new Uint8Array(
    signature.match(/.{1,2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? []
  );
  if (!expected.length) return false;

  const actual = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(JSON.stringify(payload)));
  const actualHex = Array.from(new Uint8Array(actual))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  return actualHex === signature;
}

export function encodeSignedToken(payload: Record<string, unknown>, signature: string): string {
  return btoa(JSON.stringify({ payload, signature }));
}

export function decodeSignedToken(token: string): { payload: Record<string, unknown>; signature: string } | null {
  try {
    const raw = JSON.parse(atob(token));
    if (raw && typeof raw.payload === 'object' && typeof raw.signature === 'string') {
      return raw;
    }
  } catch {
    return null;
  }
  return null;
}

export async function getSigningKey(): Promise<CryptoKey> {
  const key = await crypto.subtle.generateKey(
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    true,
    ['sign', 'verify']
  );
  return key;
}

export async function signTicketPayload(payload: Record<string, unknown>): Promise<string> {
  const json = JSON.stringify(payload);
  const key = await getSigningKey();
  const bytes = new TextEncoder().encode(json);
  const signature = await crypto.subtle.sign('HMAC', key, bytes);
  const raw = Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return raw;
}

export async function verifyTicketPayload(payload: Record<string, unknown>, signature: string): Promise<boolean> {
  const json = JSON.stringify(payload);
  const key = await getSigningKey();
  const expected = new Uint8Array(signature.match(/.{1,2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? []);
  if (!expected.length) return false;
  const actual = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(json));
  const actualHex = Array.from(new Uint8Array(actual)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return actualHex === signature;
}

export function encodeSignedToken(payload: Record<string, unknown>, signature: string): string {
  return btoa(JSON.stringify({ payload, signature }));
}

export function decodeSignedToken(token: string): { payload: Record<string, unknown>; signature: string } | null {
  try {
    const raw = JSON.parse(atob(token));
    return raw && typeof raw.payload === 'object' && typeof raw.signature === 'string' ? raw : null;
  } catch {
    return null;
  }
}

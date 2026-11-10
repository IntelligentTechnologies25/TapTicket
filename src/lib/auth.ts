import { db, type AppRole, type LocalProfile } from './db';
import { supabase, supabaseEnabled } from './supabase';

const encoder = new TextEncoder();
const PIN_ITERATIONS = 310_000;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function derivePin(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PIN_ITERATIONS },
    key,
    256
  );
  return new Uint8Array(bits);
}

export async function configureDevicePin(pin: string): Promise<void> {
  if (!/^\d{4,6}$/.test(pin)) throw new Error('PIN must contain 4 to 6 digits.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = await derivePin(pin, salt);
  await db.settings.put({ key: 'local-pin', value: { salt: toBase64(salt), digest: toBase64(digest) } });
}

export async function verifyDevicePin(pin: string): Promise<boolean> {
  if (!/^\d{4,6}$/.test(pin)) return false;
  const record = await db.settings.get('local-pin');
  if (!record || typeof record.value !== 'object' || record.value === null) return false;
  const value = record.value as { salt?: string; digest?: string };
  if (!value.salt || !value.digest) return false;
  const actual = await derivePin(pin, fromBase64(value.salt));
  const expected = fromBase64(value.digest);
  return actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);
}

export async function getCachedProfile(): Promise<LocalProfile | undefined> {
  return db.profiles.toCollection().first();
}

export async function signIn(identifier: string, password: string): Promise<LocalProfile> {
  if (!supabaseEnabled || !supabase) {
    throw new Error('Authentication is not configured. Add the Supabase URL and anon key to .env.local.');
  }
  const value = identifier.trim();
  if (!value || !password) throw new Error('Enter your phone/email and account password.');

  const credentials = value.includes('@')
    ? { email: value, password }
    : { phone: value, password };
  const { data, error } = await supabase.auth.signInWithPassword(credentials);
  if (error || !data.user) throw new Error(error?.message ?? 'Sign-in failed.');

  const { data: row, error: profileError } = await supabase
    .from('profiles')
    .select('id, company_id, role, display_name, phone, email, active')
    .eq('id', data.user.id)
    .single();
  if (profileError || !row) {
    await supabase.auth.signOut();
    throw new Error('Your account has no company profile. Ask your company administrator to enroll it.');
  }
  if (!row.active) {
    await supabase.auth.signOut();
    throw new Error('This account is disabled. Contact your company administrator.');
  }
  if (!['conductor', 'checker', 'admin', 'owner'].includes(row.role)) {
    await supabase.auth.signOut();
    throw new Error('The account has an unsupported role.');
  }

  const profile: LocalProfile = {
    id: row.id,
    companyId: row.company_id,
    role: row.role as AppRole,
    displayName: row.display_name,
    phone: row.phone,
    email: row.email,
    active: row.active,
    cachedAt: Date.now()
  };
  await db.profiles.put(profile);
  return profile;
}

export async function signOut(): Promise<void> {
  if (supabase) await supabase.auth.signOut();
}

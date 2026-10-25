// Presentation hints only. `isAdmin` mirrors the session flag so the local stack shows the same
// navigation as production; every admin route re-reads the database flag regardless.
export type DevSession = { id: string; email: string; name: string; picture: string | null; issuedAt: number; isAdmin?: boolean };

function secret(): string | null {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || null;
}

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  return bytes;
}

async function signingKey(value: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(value), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signDevSession(payload: DevSession): Promise<string> {
  const key = secret();
  if (!key) throw new Error('Development auth secret is required');
  const data = encode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(key), new TextEncoder().encode(data));
  return `${data}.${encode(new Uint8Array(signature))}`;
}

export async function verifyDevSession(cookie: string | undefined): Promise<DevSession | null> {
  const key = secret();
  if (process.env.NODE_ENV !== 'development' || process.env.DEV_AUTH_BYPASS !== '1' || !key || !cookie) return null;
  const [data, signature, extra] = cookie.split('.');
  if (!data || !signature || extra) return null;
  try {
    const signatureBytes = decode(signature);
    const dataBytes = decode(data);
    if (encode(signatureBytes) !== signature || encode(dataBytes) !== data) return null;
    const valid = await crypto.subtle.verify('HMAC', await signingKey(key), signatureBytes, new TextEncoder().encode(data));
    if (!valid) return null;
    const payload: unknown = JSON.parse(new TextDecoder().decode(dataBytes));
    if (typeof payload !== 'object' || !payload ||
        !('id' in payload) || typeof payload.id !== 'string' ||
        !('email' in payload) || typeof payload.email !== 'string' ||
        !('issuedAt' in payload) || typeof payload.issuedAt !== 'number' ||
        Date.now() - payload.issuedAt > 86_400_000 || payload.issuedAt > Date.now()) return null;
    return payload as DevSession;
  } catch { return null; }
}

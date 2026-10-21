import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signDevSession, verifyDevSession } from '@/src/lib/dev-session';

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('AUTH_SECRET', 'local-test-secret');
  vi.stubEnv('DEV_AUTH_BYPASS', '1');
});
afterEach(() => vi.unstubAllEnvs());

const payload = { id: 'user-1', email: 'test@example.com', name: 'Test', picture: null, issuedAt: Date.now() };

describe('development session cookie', () => {
  it('accepts a recent signed cookie', async () => {
    expect(await verifyDevSession(await signDevSession(payload))).toEqual(payload);
  });

  it('rejects tampering and expired cookies', async () => {
    const signed = await signDevSession(payload);
    expect(await verifyDevSession(`${signed.slice(0, -1)}x`)).toBeNull();
    const old = await signDevSession({ ...payload, issuedAt: Date.now() - 86_400_001 });
    expect(await verifyDevSession(old)).toBeNull();
  });

  it('is disabled outside development', async () => {
    const signed = await signDevSession(payload);
    vi.stubEnv('NODE_ENV', 'production');
    expect(await verifyDevSession(signed)).toBeNull();
  });

  it('requires an explicit opt-in', async () => {
    const signed = await signDevSession(payload);
    vi.stubEnv('DEV_AUTH_BYPASS', '0');
    expect(await verifyDevSession(signed)).toBeNull();
  });
});

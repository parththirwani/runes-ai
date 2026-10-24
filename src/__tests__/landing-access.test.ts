import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  verify: vi.fn(),
  redirect: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock('@/src/lib/auth', () => ({ auth: mocks.auth }));
vi.mock('@/src/lib/dev-session', () => ({ verifyDevSession: mocks.verify }));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import Home from '@/src/app/page';
import { isSignedIn } from '@/src/lib/session';
import { DOCUMENTS_PATH } from '@/src/lib/paths';

const redirectError = new Error('NEXT_REDIRECT');

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mocks.auth.mockResolvedValue(null);
  mocks.verify.mockResolvedValue(null);
  mocks.redirect.mockImplementation(() => {
    throw redirectError;
  });
  mocks.cookies.mockResolvedValue({ get: () => undefined });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('landing page access', () => {
  it('sends a signed-in visitor to the documents dashboard', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'u1', email: 'dev@runes-ai.test' } });

    await expect(Home()).rejects.toBe(redirectError);
    expect(mocks.redirect).toHaveBeenCalledWith(DOCUMENTS_PATH);
  });

  it('treats the signed development session as signed in', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    mocks.cookies.mockResolvedValue({ get: () => ({ value: 'signed.dev.cookie' }) });
    mocks.verify.mockResolvedValue({ id: 'u1' });

    await expect(Home()).rejects.toBe(redirectError);
    expect(mocks.verify).toHaveBeenCalledWith('signed.dev.cookie');
    expect(mocks.redirect).toHaveBeenCalledWith(DOCUMENTS_PATH);
  });

  it('renders the landing page for anonymous visitors', async () => {
    const view = await Home();

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(view).toBeTruthy();
  });

  it('ignores the development session outside development', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mocks.verify.mockResolvedValue({ id: 'u1' });

    await expect(isSignedIn()).resolves.toBe(false);
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  it('keeps the landing page reachable when auth is misconfigured', async () => {
    mocks.auth.mockRejectedValue(new Error('Missing AUTH_SECRET'));

    await expect(isSignedIn()).resolves.toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  verify: vi.fn(),
  redirect: vi.fn(),
  cookies: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock('@/src/lib/auth', () => ({ auth: mocks.auth }));
vi.mock('@/src/lib/dev-session', () => ({ verifyDevSession: mocks.verify }));
vi.mock('@/src/lib/db', () => ({ prisma: { user: { findUnique: mocks.findUnique } } }));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import Home from '@/src/app/page';
import { resolvePageSession, resolveRequestSession } from '@/src/lib/session';
import { DOCUMENTS_PATH } from '@/src/lib/paths';

const redirectError = new Error('NEXT_REDIRECT');
const devUser = { id: 'u1', email: 'dev@runes-ai.test', firstName: 'Dev', lastName: 'User' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('NODE_ENV', 'development');
  mocks.auth.mockResolvedValue(null);
  mocks.verify.mockResolvedValue(null);
  mocks.findUnique.mockResolvedValue(devUser);
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
    mocks.auth.mockResolvedValue({ user: { id: 'u1', email: devUser.email } });

    await expect(Home()).rejects.toBe(redirectError);
    expect(mocks.redirect).toHaveBeenCalledWith(DOCUMENTS_PATH);
  });

  it('treats the signed development session as signed in', async () => {
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
});

describe('session acceptance shared with the document API', () => {
  it('rejects a session without a user id instead of redirecting', async () => {
    mocks.auth.mockResolvedValue({ user: { email: devUser.email } });

    await expect(Home()).resolves.toBeTruthy();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('rejects a valid dev cookie whose user was deleted', async () => {
    mocks.cookies.mockResolvedValue({ get: () => ({ value: 'signed.dev.cookie' }) });
    mocks.verify.mockResolvedValue({ id: 'gone' });
    mocks.findUnique.mockResolvedValue(null);

    await expect(Home()).resolves.toBeTruthy();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('rejects a dev cookie when the user lookup fails', async () => {
    mocks.cookies.mockResolvedValue({ get: () => ({ value: 'signed.dev.cookie' }) });
    mocks.verify.mockResolvedValue({ id: 'u1' });
    mocks.findUnique.mockRejectedValue(new Error('db unreachable'));

    await expect(resolvePageSession()).resolves.toBeNull();
  });

  it('ignores the development session outside development', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mocks.verify.mockResolvedValue({ id: 'u1' });

    await expect(resolvePageSession()).resolves.toBeNull();
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  it('accepts the route-level dev cookie with the same rule', async () => {
    mocks.verify.mockResolvedValue({ id: 'u1' });

    await expect(resolveRequestSession('signed.dev.cookie')).resolves.toMatchObject({
      user: { id: 'u1', email: devUser.email },
    });
  });

  it('keeps the landing page reachable when auth is misconfigured', async () => {
    mocks.auth.mockRejectedValue(new Error('Missing AUTH_SECRET'));

    await expect(resolvePageSession()).resolves.toBeNull();
    await expect(resolveRequestSession('signed.dev.cookie')).resolves.toBeNull();
  });
});

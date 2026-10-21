import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), verify: vi.fn(), findUnique: vi.fn() }));
vi.mock('@/src/lib/auth', () => ({ auth: mocks.auth }));
vi.mock('@/src/lib/db', () => ({ prisma: { user: { findUnique: mocks.findUnique } } }));
vi.mock('@/src/lib/dev-session', () => ({ verifyDevSession: mocks.verify }));

import { withAuth } from '@/src/lib/withAuth';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'development');
  mocks.auth.mockResolvedValue(null);
  mocks.verify.mockResolvedValue(null);
});

describe('route authentication', () => {
  it('denies an anonymous request before invoking the handler', async () => {
    const handler = vi.fn();
    const response = await withAuth(handler)(new NextRequest('http://localhost/api/ai/complete'), { params: Promise.resolve({}) });
    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('requires the signed development identity to exist in the database', async () => {
    mocks.verify.mockResolvedValue({ id: 'missing' });
    mocks.findUnique.mockResolvedValue(null);
    const handler = vi.fn();
    const response = await withAuth(handler)(new NextRequest('http://localhost/api/ai/complete', {
      headers: { cookie: 'dev-session=signed' },
    }), { params: Promise.resolve({}) });
    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findFirst, deleteMany } = vi.hoisted(() => ({ findFirst: vi.fn(), deleteMany: vi.fn() }));
vi.mock('@/src/lib/db', () => ({ prisma: { workspace: { findFirst, deleteMany } } }));

import { deletePersonalWorkspace } from '@/src/lib/workspaces';

describe('personal workspace deletion', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('deletes an owned, non-default workspace only when it has no documents', async () => {
    findFirst.mockResolvedValue({ isDefault: false });
    deleteMany.mockResolvedValue({ count: 1 });
    expect(await deletePersonalWorkspace('owner', 'ws-empty')).toBe(true);
    expect(deleteMany).toHaveBeenCalledWith({ where: {
      id: 'ws-empty', ownerUserId: 'owner', kind: 'PERSONAL', isDefault: false, documents: { none: {} },
    } });
  });

  it('hides foreign workspaces and protects the default workspace', async () => {
    findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ isDefault: true });
    expect(await deletePersonalWorkspace('owner', 'foreign')).toBe(false);
    await expect(deletePersonalWorkspace('owner', 'default')).rejects.toMatchObject({ status: 409 });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('preserves documents when a workspace is occupied or a create races deletion', async () => {
    findFirst.mockResolvedValue({ isDefault: false });
    deleteMany.mockResolvedValueOnce({ count: 0 }).mockRejectedValueOnce({ code: 'P2003' });
    for (const id of ['occupied', 'raced']) {
      await expect(deletePersonalWorkspace('owner', id)).rejects.toMatchObject({
        status: 409, message: 'Move or delete the documents in this workspace first',
      });
    }
  });
});

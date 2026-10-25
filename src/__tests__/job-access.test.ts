import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeWorld, actors, type FakeWorld } from '@/src/__tests__/helpers/access-fake';

// The job routes must answer from *current* document access, not from the userId stamped into
// the job when it was queued. The world below is the same fixture the access matrix uses, so
// "removed team member" and "accepted recipient" behave exactly like they do in the app.
const holder = vi.hoisted(() => ({
  users: [] as unknown[],
  workspaces: [] as unknown[],
  documents: [] as unknown[],
  memberships: [] as unknown[],
  workspaceGrants: [] as unknown[],
  documentGrants: [] as unknown[],
}));

function loadWorld(world: FakeWorld) {
  holder.users = world.users;
  holder.workspaces = world.workspaces;
  holder.documents = world.documents;
  holder.memberships = world.memberships;
  holder.workspaceGrants = world.workspaceGrants;
  holder.documentGrants = world.documentGrants;
}

const mocks = vi.hoisted(() => ({
  userId: 'owner',
  getRawJobData: vi.fn(),
  getJobStatus: vi.fn(),
  getPDF: vi.fn(),
  cancelJob: vi.fn(),
}));

vi.mock('@/src/lib/withAuth', () => ({
  withAuth: (handler: (req: NextRequest, session: { user: { id: string } }, context: unknown) => Promise<Response>) =>
    (req: NextRequest, context: unknown) => handler(req, { user: { id: mocks.userId } }, context),
}));
vi.mock('@/producer/queue', () => ({ compilationProducer: mocks }));
vi.mock('@/src/lib/db', async () => {
  const { makeAccessClient } = await import('@/src/__tests__/helpers/access-fake');
  return { prisma: makeAccessClient(holder as never) };
});

import { GET as jobGet, DELETE as jobDelete } from '@/src/app/api/job/[jobId]/route';
import { GET as pdfGet } from '@/src/app/api/pdf/[jobId]/route';

const context = { params: Promise.resolve({ jobId: 'job-1' }) };
const request = new NextRequest('http://localhost/api/job/job-1');

function jobFor(userId: string, documentId: string) {
  mocks.getRawJobData.mockResolvedValue(JSON.stringify({ userId, documentId }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userId = actors.authorA;
  loadWorld(makeWorld());
  jobFor(actors.authorA, 'doc-team');
  mocks.getJobStatus.mockResolvedValue({ status: 'completed' });
  mocks.getPDF.mockResolvedValue(Buffer.from('%PDF-test'));
  mocks.cancelJob.mockResolvedValue(true);
});

describe('job routes authorise against the document, on every request', () => {
  it('denies status, cancel, and PDF to a stranger who learned a job id', async () => {
    mocks.userId = actors.unrelatedC;
    expect((await jobGet(request, context)).status).toBe(404);
    expect((await jobDelete(request, context)).status).toBe(404);
    expect((await pdfGet(request, context)).status).toBe(404);
    expect(mocks.getJobStatus).not.toHaveBeenCalled();
    expect(mocks.getPDF).not.toHaveBeenCalled();
    expect(mocks.cancelJob).not.toHaveBeenCalled();
  });

  it('denies the submitting author after the team removes them', async () => {
    // The reported hole: the job's userId still matches, but membership is gone, so current
    // access must win and the old job id must stop returning anything.
    loadWorld(makeWorld({ authorRemovedFromTeam: true }));
    mocks.userId = actors.authorA;
    expect((await jobGet(request, context)).status).toBe(404);
    expect((await jobDelete(request, context)).status).toBe(404);
    expect((await pdfGet(request, context)).status).toBe(404);
    expect(mocks.getPDF).not.toHaveBeenCalled();
    expect(mocks.cancelJob).not.toHaveBeenCalled();
  });

  it('allows the active author to poll status, download the PDF, and cancel', async () => {
    const status = await jobGet(request, context);
    expect(status.status).toBe(200);
    expect((await status.json()).status).toBe('completed');
    const pdf = await pdfGet(request, context);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('Content-Type')).toBe('application/pdf');
    expect((await jobDelete(request, context)).status).toBe(200);
  });

  it('lets an accepted viewer read status and the PDF but never cancel', async () => {
    loadWorld(makeWorld({ documentGrant: { documentId: 'doc-team' } }));
    mocks.userId = actors.viewerB;
    jobFor(actors.authorA, 'doc-team');
    expect((await jobGet(request, context)).status).toBe(200);
    expect((await pdfGet(request, context)).status).toBe(200);
    expect((await jobDelete(request, context)).status).toBe(404);
    expect(mocks.cancelJob).not.toHaveBeenCalled();
  });

  it('revokes a reading viewer the moment the grant is withdrawn', async () => {
    loadWorld(makeWorld({ documentGrant: { documentId: 'doc-team', revokedAt: new Date() } }));
    mocks.userId = actors.viewerB;
    expect((await pdfGet(request, context)).status).toBe(404);
  });

  it('returns the same denial for a missing job or a job without a documentId', async () => {
    mocks.getRawJobData.mockResolvedValue(null);
    expect((await jobGet(request, context)).status).toBe(404);
    jobFor(actors.authorA, '');
    expect((await jobGet(request, context)).status).toBe(404);
    mocks.getRawJobData.mockResolvedValue('{not json');
    expect((await pdfGet(request, context)).status).toBe(404);
  });
});

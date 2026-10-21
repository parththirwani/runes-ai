import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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

import { GET as jobGet, DELETE as jobDelete } from '@/src/app/api/job/[jobId]/route';
import { GET as pdfGet } from '@/src/app/api/pdf/[jobId]/route';

const context = { params: Promise.resolve({ jobId: 'job-1' }) };
const request = new NextRequest('http://localhost/api/job/job-1');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userId = 'owner';
  mocks.getRawJobData.mockResolvedValue(JSON.stringify({ userId: 'owner' }));
  mocks.getJobStatus.mockResolvedValue({ status: 'completed' });
  mocks.getPDF.mockResolvedValue(Buffer.from('%PDF-test'));
  mocks.cancelJob.mockResolvedValue(true);
});

describe('compilation result ownership', () => {
  it('denies status, cancel, and PDF to a different user', async () => {
    mocks.userId = 'other';
    expect((await jobGet(request, context)).status).toBe(404);
    expect((await jobDelete(request, context)).status).toBe(404);
    expect((await pdfGet(request, context)).status).toBe(404);
    expect(mocks.getJobStatus).not.toHaveBeenCalled();
    expect(mocks.getPDF).not.toHaveBeenCalled();
    expect(mocks.cancelJob).not.toHaveBeenCalled();
  });

  it('allows the owner to read a completed job and its PDF', async () => {
    const status = await jobGet(request, context);
    expect(status.status).toBe(200);
    expect((await status.json()).status).toBe('completed');
    const pdf = await pdfGet(request, context);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('Content-Type')).toBe('application/pdf');
  });

  it('returns the same denial for a missing job', async () => {
    mocks.getRawJobData.mockResolvedValue(null);
    expect((await jobGet(request, context)).status).toBe(404);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  redis: {
    sadd: vi.fn(), srem: vi.fn(), smembers: vi.fn(), scard: vi.fn(),
    get: vi.fn(), setex: vi.fn(), blpop: vi.fn(), llen: vi.fn(), expire: vi.fn(),
  },
  compileLatex: vi.fn(),
  compileMarkdown: vi.fn(),
}));

vi.mock('@/src/lib/redis', () => ({
  default: mocks.redis,
  QUEUE_NAME: 'q', PROCESSING_SET: 'p', JOB_PREFIX: 'job:', PDF_PREFIX: 'pdf:', RESULT_TTL: 60, RESULT_PREFIX: 'res:',
}));
vi.mock('@/worker/latex-compiler', () => ({ compileLatexToPDF: mocks.compileLatex }));
vi.mock('@/worker/markdown-compiler', () => ({ compileMarkdownToPDF: mocks.compileMarkdown }));

import { CompilationWorker } from '@/worker/worker';

function jobPayload(job: Record<string, unknown>) {
  mocks.redis.get.mockImplementation((key: string) =>
    Promise.resolve(key.startsWith('res:') ? JSON.stringify({ status: 'pending' }) : key.startsWith('job:') ? JSON.stringify(job) : null));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redis.smembers.mockResolvedValue([]);
  mocks.redis.setex.mockResolvedValue('OK');
  mocks.redis.sadd.mockResolvedValue(1);
  mocks.redis.srem.mockResolvedValue(1);
  mocks.redis.expire.mockResolvedValue(1);
});

describe('worker compiler dispatch', () => {
  it('sends LATEX jobs to the Tectonic LaTeX compiler', async () => {
    const worker = new CompilationWorker();
    jobPayload({ id: 'j1', documentId: 'd1', userId: 'u1', slug: 's', content: '\\begin{document}', format: 'LATEX', createdAt: 1 });
    mocks.compileLatex.mockResolvedValue({ success: true, pdfBuffer: Buffer.from('%PDF-test'), duration: 5 });
    await (worker as unknown as { processJob(id: string): Promise<void> }).processJob('j1');
    expect(mocks.compileLatex).toHaveBeenCalledTimes(1);
    expect(mocks.compileMarkdown).not.toHaveBeenCalled();
  });

  it('sends MARKDOWN jobs to the Pandoc compiler with snapshot assets', async () => {
    const worker = new CompilationWorker();
    const assets = [{ path: 'images/a.png', mediaType: 'image/png', data: 'AQID' }];
    jobPayload({ id: 'j2', documentId: 'd2', userId: 'u1', slug: 's', content: '# Hi', format: 'MARKDOWN', assets, createdAt: 1 });
    mocks.compileMarkdown.mockResolvedValue({ success: true, pdfBuffer: Buffer.from('%PDF-test'), duration: 5 });
    await (worker as unknown as { processJob(id: string): Promise<void> }).processJob('j2');
    expect(mocks.compileMarkdown).toHaveBeenCalledWith('# Hi', 's', { timeout: 120000, assets });
    expect(mocks.compileLatex).not.toHaveBeenCalled();
  });

  it('rejects jobs with missing or unknown format instead of guessing a compiler', async () => {
    const worker = new CompilationWorker();
    for (const format of [undefined, 'PDF', 'latex']) {
      jobPayload({ id: 'j3', documentId: 'd3', userId: 'u1', slug: 's', content: 'anything', format, createdAt: 1 });
      await expect(
        (worker as unknown as { processJob(id: string): Promise<void> }).processJob('j3'),
      ).rejects.toThrow('valid document format');
    }
    expect(mocks.compileLatex).not.toHaveBeenCalled();
    expect(mocks.compileMarkdown).not.toHaveBeenCalled();
  });

  it('rejects markdown snapshots with path-traversal asset paths', async () => {
    const worker = new CompilationWorker();
    jobPayload({
      id: 'j4', documentId: 'd4', userId: 'u1', slug: 's', content: '# Hi', format: 'MARKDOWN',
      assets: [{ path: '../escape.png', mediaType: 'image/png', data: 'AQID' }], createdAt: 1,
    });
    await expect(
      (worker as unknown as { processJob(id: string): Promise<void> }).processJob('j4'),
    ).rejects.toThrow('Invalid asset path');
    expect(mocks.compileMarkdown).not.toHaveBeenCalled();
  });

  it('stores the PDF and marks completion for markdown jobs', async () => {
    const worker = new CompilationWorker();
    jobPayload({ id: 'j5', documentId: 'd5', userId: 'u1', slug: 's', content: '# Hi', format: 'MARKDOWN', createdAt: 1 });
    mocks.compileMarkdown.mockResolvedValue({ success: true, pdfBuffer: Buffer.from('%PDF-1.5 test'), duration: 7 });
    await (worker as unknown as { processJob(id: string): Promise<void> }).processJob('j5');
    const pdfCall = mocks.redis.setex.mock.calls.find((call) => String(call[0]).startsWith('pdf:'));
    expect(pdfCall).toBeTruthy();
    const completed = mocks.redis.setex.mock.calls.some((call) => String(call[2]).includes('"completed"'));
    expect(completed).toBe(true);
  });
});

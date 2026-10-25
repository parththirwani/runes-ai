import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the handful of Redis commands the queue uses.
const store = new Map<string, string>();
const queues = new Map<string, string[]>();

const redis = vi.hoisted(() => ({
  set: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
  setex: vi.fn(),
  expire: vi.fn(),
  rpush: vi.fn(),
  llen: vi.fn(),
  lrem: vi.fn(),
  ltrim: vi.fn(),
  lrange: vi.fn(),
  getBuffer: vi.fn(),
  pipeline: vi.fn(),
}));

vi.mock('@/src/lib/redis', () => ({
  default: redis,
  JOB_PREFIX: 'latex:job:',
  RESULT_PREFIX: 'latex:result:',
  PDF_PREFIX: 'latex:pdf:',
  QUEUE_NAME: 'latex:compilation:queue',
  PROCESSING_SET: 'latex:compilation:processing',
  SNAPSHOT_JOB_PREFIX: 'latex:snapshot:job:',
  DOCUMENT_JOBS_PREFIX: 'latex:document-jobs:',
  DOCUMENT_JOBS_KEPT: 10,
  RESULT_TTL: 86400,
}));

import { compilationProducer, snapshotJobKey } from '@/producer/queue';
import { JobStatus } from '@/src/types/compilation';

const DIGEST = 'a'.repeat(64);

function claimResult(value: string | null) {
  return value;
}

beforeEach(() => {
  store.clear();
  queues.clear();
  vi.clearAllMocks();

  redis.set.mockImplementation(async (key: string, value: string, ...rest: unknown[]) => {
    const nx = rest.includes('NX');
    if (nx && store.has(key)) return claimResult(null);
    store.set(key, value);
    return 'OK';
  });
  redis.get.mockImplementation(async (key: string) => store.get(key) ?? null);
  redis.del.mockImplementation(async (key: string) => {
    store.delete(key);
    return 1;
  });
  redis.setex.mockImplementation(async (key: string, _ttl: number, value: string) => {
    store.set(key, value);
    return 'OK';
  });
  redis.expire.mockResolvedValue('OK');
  redis.rpush.mockImplementation(async (queue: string, value: string) => {
    queues.set(queue, [...(queues.get(queue) || []), value]);
    return 1;
  });
  redis.llen.mockImplementation(async (queue: string) => (queues.get(queue) || []).length);
  redis.lrem.mockImplementation(async (queue: string, _count: number, value: string) => {
    const list = (queues.get(queue) || []).filter((item) => item !== value);
    const removed = (queues.get(queue) || []).length - list.length;
    queues.set(queue, list);
    return removed;
  });
  redis.ltrim.mockImplementation(async (key: string, start: number, stop: number) => {
    const list = queues.get(key) || [];
    const from = start < 0 ? Math.max(0, list.length + start) : start;
    const to = stop < 0 ? list.length + stop : stop;
    queues.set(key, list.slice(from, to + 1));
    return 1;
  });
  redis.lrange.mockImplementation(async (key: string, start: number, stop: number) => {
    const list = queues.get(key) || [];
    const from = start < 0 ? Math.max(0, list.length + start) : start;
    const to = stop < 0 ? list.length + stop : stop;
    return list.slice(from, to + 1);
  });
  redis.pipeline.mockImplementation(() => {
    const ops: Array<() => Promise<unknown>> = [];
    const chain: Record<string, (...args: unknown[]) => unknown> = {};
    for (const method of ['setex', 'rpush', 'expire', 'ltrim', 'set', 'del']) {
      chain[method] = (...args: unknown[]) => {
        const operation = (redis as unknown as Record<string, (...values: unknown[]) => Promise<unknown>>)[method];
        ops.push(() => operation(...args));
        return chain;
      };
    }
    chain.exec = async () => {
      for (const operation of ops) await operation();
      return ops.map(() => [null, 'OK']);
    };
    return chain;
  });
});

const jobInput = { documentId: 'doc-1', userId: 'user-1', slug: 'paper', mainFile: 'main.tex', digest: DIGEST, files: [] };

describe('snapshot deduplication', () => {
  it('queues the first compile for a digest and pushes it onto the queue', async () => {
    const result = await compilationProducer.addSnapshotJob(jobInput);
    expect(result.reused).toBe('new');
    expect(queues.get('latex:compilation:queue')).toHaveLength(1);
    expect(store.get(snapshotJobKey('user-1', DIGEST))).toBe(result.jobId);
  });

  it('points a second identical request at the job that is already running', async () => {
    const first = await compilationProducer.addSnapshotJob(jobInput);
    store.set(`${'latex:result:'}${first.jobId}`, JSON.stringify({ status: JobStatus.PROCESSING, createdAt: Date.now() }));

    const second = await compilationProducer.addSnapshotJob(jobInput);
    expect(second).toEqual({ jobId: first.jobId, reused: 'running' });
    expect(queues.get('latex:compilation:queue')).toHaveLength(1);
  });

  it('reuses a completed artifact for the same snapshot instead of recompiling', async () => {
    const first = await compilationProducer.addSnapshotJob(jobInput);
    store.set(`latex:result:${first.jobId}`, JSON.stringify({ status: JobStatus.COMPLETED, createdAt: 1, completedAt: 2 }));

    const second = await compilationProducer.addSnapshotJob(jobInput);
    expect(second).toEqual({ jobId: first.jobId, reused: 'completed' });
    expect(queues.get('latex:compilation:queue')).toHaveLength(1);
  });

  it('queues a fresh job when the previous attempt for the digest failed', async () => {
    const first = await compilationProducer.addSnapshotJob(jobInput);
    store.set(`latex:result:${first.jobId}`, JSON.stringify({ status: JobStatus.FAILED, createdAt: 1, completedAt: 2 }));

    const retry = await compilationProducer.addSnapshotJob(jobInput);
    expect(retry.reused).toBe('new');
    expect(retry.jobId).not.toBe(first.jobId);
    expect(queues.get('latex:compilation:queue')).toHaveLength(2);
  });

  it('keeps two users with identical bytes from sharing a claim', async () => {
    const mine = await compilationProducer.addSnapshotJob(jobInput);
    const theirs = await compilationProducer.addSnapshotJob({ ...jobInput, userId: 'user-2', documentId: 'doc-2' });

    expect(theirs.reused).toBe('new');
    expect(theirs.jobId).not.toBe(mine.jobId);
    expect(snapshotJobKey('user-1', DIGEST)).not.toBe(snapshotJobKey('user-2', DIGEST));
  });

  it('releases the claim after a failure so the next click can retry', async () => {
    const first = await compilationProducer.addSnapshotJob(jobInput);
    await compilationProducer.releaseSnapshotClaim('user-1', DIGEST, 'some-other-job');
    expect(store.get(snapshotJobKey('user-1', DIGEST))).toBe(first.jobId);

    await compilationProducer.releaseSnapshotClaim('user-1', DIGEST, first.jobId);
    expect(store.has(snapshotJobKey('user-1', DIGEST))).toBe(false);
  });

  it('stores the snapshot digest and job owner with the job for later authorization', async () => {
    const { jobId } = await compilationProducer.addSnapshotJob(jobInput);
    const job = JSON.parse(store.get(`latex:job:${jobId}`)!) as Record<string, unknown>;
    expect(job).toMatchObject({ userId: 'user-1', documentId: 'doc-1', snapshotDigest: DIGEST, mainFile: 'main.tex' });

    const status = JSON.parse(store.get(`latex:result:${jobId}`)!) as { timings?: Record<string, number> };
    expect(typeof status.timings?.requestedAt).toBe('number');
    expect(typeof status.timings?.enqueuedAt).toBe('number');
  });
});

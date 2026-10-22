import redis, {
  JOB_PREFIX,
  RESULT_TTL,
  QUEUE_NAME,
  RESULT_PREFIX,
  PDF_PREFIX,
  SNAPSHOT_JOB_PREFIX,
} from '@/src/lib/redis';
import { CompilationJob, JobStatus, JobStatusResponse, SnapshotFileRef, StageTimings } from '@/src/types/compilation';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

export type EnqueueResult = {
  jobId: string;
  /** 'new' means the worker will run it; 'running' and 'completed' mean nothing was queued. */
  reused: 'new' | 'running' | 'completed';
};

/**
 * Cache key for a snapshot. The user id is part of the key so two users who happen to
 * upload byte-identical workspaces never share an authorized artifact handle.
 */
export function snapshotJobKey(userId: string, digest: string): string {
  return SNAPSHOT_JOB_PREFIX + crypto.createHash('sha256').update(userId + ':' + digest).digest('hex');
}

export class CompilationProducer {
  /**
   * Enqueues a workspace snapshot, or points the caller at work that already exists for
   * the same digest. Claiming with SET NX keeps two simultaneous clicks from compiling
   * the same bytes twice.
   */
  async addSnapshotJob(input: {
    documentId: string;
    userId: string;
    slug: string;
    mainFile: string;
    digest: string;
    files: SnapshotFileRef[];
  }): Promise<EnqueueResult> {
    const key = snapshotJobKey(input.userId, input.digest);
    const jobId = uuidv4();
    const requestedAt = Date.now();

    const claimed = await redis.set(key, jobId, 'EX', RESULT_TTL, 'NX');
    if (!claimed) {
      const existingJobId = await redis.get(key);
      if (existingJobId) {
        const status = await this.getJobStatus(existingJobId);
        if (status && (status.status === JobStatus.PENDING || status.status === JobStatus.PROCESSING)) {
          return { jobId: existingJobId, reused: 'running' };
        }
        if (status && status.status === JobStatus.COMPLETED) {
          return { jobId: existingJobId, reused: 'completed' };
        }
        // The previous attempt failed or its record expired: take over the claim.
        await redis.set(key, jobId, 'EX', RESULT_TTL);
      }
    }

    const job: CompilationJob = {
      id: jobId,
      documentId: input.documentId,
      userId: input.userId,
      slug: input.slug,
      snapshotDigest: input.digest,
      mainFile: input.mainFile,
      createdAt: requestedAt,
      requestedAt,
    };

    const pipeline = redis.pipeline();
    pipeline.setex(`${JOB_PREFIX}${jobId}`, RESULT_TTL, JSON.stringify(job));
    pipeline.rpush(QUEUE_NAME, jobId);
    pipeline.setex(
      `${RESULT_PREFIX}${jobId}`,
      RESULT_TTL,
      JSON.stringify({ status: JobStatus.PENDING, createdAt: requestedAt, timings: { requestedAt, enqueuedAt: Date.now() }, snapshot: { digest: input.digest, mainFile: input.mainFile, files: input.files } } satisfies JobStatusResponse),
    );
    await pipeline.exec();

    return { jobId, reused: 'new' };
  }

  /** Legacy single-source enqueue, kept for in-flight jobs during a rolling deploy. */
  async addJob(job: Omit<CompilationJob, 'id' | 'createdAt'>): Promise<string> {
    const jobId = uuidv4();
    const compilationJob: CompilationJob = { ...job, id: jobId, createdAt: Date.now() };

    const pipeline = redis.pipeline();
    pipeline.setex(`${JOB_PREFIX}${jobId}`, RESULT_TTL, JSON.stringify(compilationJob));
    pipeline.rpush(QUEUE_NAME, jobId);
    pipeline.setex(
      `${RESULT_PREFIX}${jobId}`,
      RESULT_TTL,
      JSON.stringify({ status: JobStatus.PENDING, createdAt: compilationJob.createdAt, timings: { requestedAt: compilationJob.createdAt, enqueuedAt: Date.now() } }),
    );
    await pipeline.exec();

    return jobId;
  }

  async getJobStatus(jobId: string): Promise<JobStatusResponse | null> {
    const resultData = await redis.get(`${RESULT_PREFIX}${jobId}`);
    if (!resultData) return null;
    return JSON.parse(resultData) as JobStatusResponse;
  }

  async getRawJobData(jobId: string): Promise<string | null> {
    return await redis.get(`${JOB_PREFIX}${jobId}`);
  }

  async getPDF(jobId: string): Promise<Buffer | null> {
    return await redis.getBuffer(`${PDF_PREFIX}${jobId}`);
  }

  async getQueueLength(): Promise<number> {
    return await redis.llen(QUEUE_NAME);
  }

  /** Lets the next click retry a snapshot whose previous attempt failed. */
  async releaseSnapshotClaim(userId: string, digest: string, jobId: string): Promise<void> {
    const key = snapshotJobKey(userId, digest);
    const current = await redis.get(key);
    if (current === jobId) await redis.del(key);
  }

  async cancelJob(jobId: string): Promise<boolean> {
    const removed = await redis.lrem(QUEUE_NAME, 1, jobId);
    if (removed === 0) return false;

    const raw = await redis.get(`${JOB_PREFIX}${jobId}`);
    const timings: StageTimings = { completedAt: Date.now() };
    await redis.setex(
      `${RESULT_PREFIX}${jobId}`,
      RESULT_TTL,
      JSON.stringify({
        status: JobStatus.FAILED,
        result: { success: false, error: 'Job cancelled by user', duration: 0 },
        timings,
        createdAt: raw ? (JSON.parse(raw).createdAt as number) : Date.now(),
        completedAt: Date.now(),
      }),
    );
    await redis.expire(`${JOB_PREFIX}${jobId}`, RESULT_TTL);
    if (raw) {
      const job = JSON.parse(raw) as CompilationJob;
      if (job.snapshotDigest) await this.releaseSnapshotClaim(job.userId, job.snapshotDigest, jobId);
    }
    return true;
  }
}

export const compilationProducer = new CompilationProducer();

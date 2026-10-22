// Compilation worker.
//
// Latency rules that must not regress:
//   * a loop takes the next job as soon as it finishes one; BLPOP is the only wait
//   * nothing sleeps between the engine exiting and the PDF being stored
//   * every stage records a timestamp so the numbers can be measured, not guessed

import redis, {
  QUEUE_NAME,
  PROCESSING_SET,
  JOB_PREFIX,
  PDF_PREFIX,
  RESULT_TTL,
  RESULT_PREFIX,
} from '@/src/lib/redis';
import { JobStatus, CompilationJob, JobStatusResponse, StageTimings } from '@/src/types/compilation';
import { compileJobDirectory, compileLatexToPDF, engineVersion, configuredEngine, compilerOptionsForCacheKey } from './latex-compiler';
import { compileMarkdownToPDF } from './markdown-compiler';
import { createJobDirectory, materializeLegacySource, materializeSnapshot, pruneJobDirectories, removeJobDirectory } from './snapshot-materialize';
import { loadSnapshotBundle } from '@/src/lib/workspace-snapshot';
import { compileTmpDir, pruneSnapshots } from '@/src/lib/storage';
import { parseCompileErrors, formatCompileError, errorExcerpt } from '@/src/lib/compile-errors';

// BLPOP parks its connection for the whole timeout. On a shared ioredis client that
// delays every other command queued behind it, including the writes that publish job
// results, so the queue read gets a connection of its own.
const blockingRedis = typeof (redis as { duplicate?: () => typeof redis }).duplicate === 'function'
  ? (redis as { duplicate: () => typeof redis }).duplicate()
  : redis;

const DEFAULT_CONCURRENCY = 2;
const BLPOP_TIMEOUT_SECONDS = 5;

export class CompilationWorker {
  private isRunning = false;
  private readonly concurrency: number;
  private readonly processingTimeout = 300000; // 5 minutes
  private readonly compileTimeout = Number(process.env.COMPILE_TIMEOUT_MS || 90000);
  private loops: Promise<void>[] = [];
  private activeJobs = new Set<string>();

  constructor(concurrency?: number) {
    const configured = Number(process.env.WORKER_CONCURRENCY);
    const resolved = concurrency ?? (Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_CONCURRENCY);
    this.concurrency = Math.max(1, Math.min(8, resolved));
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[WORKER] Already running');
      return;
    }
    this.isRunning = true;
    console.log('[WORKER] Starting worker with concurrency ' + this.concurrency + ' engine=' + configuredEngine());

    await this.cleanupAfterRestart();

    this.loops = Array.from({ length: this.concurrency }, (_, index) => this.processLoop(index + 1));
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    console.log('[WORKER] Stopping worker...');
    await Promise.allSettled(this.loops);
    await blockingRedis.quit().catch(() => undefined);
  }

  private async cleanupAfterRestart(): Promise<void> {
    const tmpRoot = compileTmpDir();
    const removedDirs = await pruneJobDirectories(tmpRoot, this.processingTimeout);
    if (removedDirs > 0) console.log('[WORKER] Removed ' + removedDirs + ' stale job directories');
    // Snapshot bundles are only needed until their job runs; a repeat compile rewrites one.
    const removedBundles = await pruneSnapshots(RESULT_TTL * 1000);
    if (removedBundles > 0) console.log('[WORKER] Removed ' + removedBundles + ' expired snapshot bundles');
    await this.cleanupStuckJobs();
  }

  private async processLoop(index: number): Promise<void> {
    while (this.isRunning) {
      try {
        const result = await blockingRedis.blpop(QUEUE_NAME, BLPOP_TIMEOUT_SECONDS);
        if (!result) continue; // blocking wait expired, ask again immediately
        const jobId = result[1];
        await this.processJob(jobId, index);
      } catch (error) {
        console.error('[WORKER] Error in process loop ' + index + ':', error);
      }
    }
    console.log('[WORKER] Loop ' + index + ' stopped');
  }

  private async processJob(jobId: string, loop: number): Promise<void> {
    const dequeuedAt = Date.now();
    this.activeJobs.add(jobId);
    await redis.sadd(PROCESSING_SET, jobId);

    try {
      const rawJob = await redis.get(`${JOB_PREFIX}${jobId}`);
      if (!rawJob) throw new Error('Job data not found');
      const job: CompilationJob = JSON.parse(rawJob);
      const timings: StageTimings = {
        requestedAt: job.requestedAt ?? job.createdAt,
        dequeuedAt,
        queueWaitMs: dequeuedAt - (job.requestedAt ?? job.createdAt),
      };

      await this.writeStatus(jobId, JobStatus.PROCESSING, { timings });

      // Rolling-deploy compatibility for single-source jobs emitted by the document API.
      if (!job.snapshotDigest && typeof job.content === 'string') {
        if (job.format !== 'LATEX' && job.format !== 'MARKDOWN') throw new Error('Job must include a valid document format');
        if (job.format === 'MARKDOWN') {
          for (const asset of job.assets ?? []) {
            if (asset.path.startsWith('/') || asset.path.split('/').includes('..')) throw new Error('Invalid asset path');
          }
        }
        const result = job.format === 'MARKDOWN'
          ? await compileMarkdownToPDF(job.content, job.slug, { timeout: 120000, assets: job.assets })
          : await compileLatexToPDF(job.content, job.slug, { timeout: 120000 });
        if (!result.success || !result.pdfBuffer) throw new Error(result.error || 'Compilation failed');
        await redis.setex(`${PDF_PREFIX}${jobId}`, RESULT_TTL, result.pdfBuffer);
        await this.markJobCompleted(jobId, { success: true, duration: result.duration }, { ...timings, completedAt: Date.now() });
        return;
      }

      const mainFile = job.mainFile || 'main.tex';
      let jobDir: string | null = null;

      try {
        jobDir = await createJobDirectory(compileTmpDir(), jobId);
        const materializeStart = performance.now();

        if (job.snapshotDigest) {
          const bundle = await loadSnapshotBundle(job.snapshotDigest);
          if (!bundle) throw new Error('Snapshot bundle is missing for this compile');
          if (bundle.userId !== job.userId || bundle.documentId !== job.documentId) {
            throw new Error('Snapshot does not belong to this document');
          }
          await materializeSnapshot(bundle, jobDir);
        } else if (typeof job.content === 'string') {
          await materializeLegacySource(job.content, mainFile, jobDir);
        } else {
          throw new Error('Job contained neither a snapshot nor source content');
        }
        const materializeMs = Math.round(performance.now() - materializeStart);

        timings.compileStartedAt = Date.now();
        const outcome = await compileJobDirectory({
          jobDir,
          mainFile,
          timeoutMs: this.compileTimeout,
          materializeMs,
        });
        timings.compileEndedAt = Date.now();
        timings.compileMs = timings.compileEndedAt - timings.compileStartedAt;
        timings.compiler = outcome.timings;

        console.log(
          '[TIMING] job=' + jobId + ' loop=' + loop +
          ' queue=' + (timings.queueWaitMs ?? 0) +
          ' materialize=' + materializeMs +
          ' spawn=' + outcome.timings.processSpawnMs +
          ' engine=' + outcome.timings.engineMs +
          ' pdfRead=' + outcome.timings.pdfReadMs +
          ' compile=' + timings.compileMs,
        );

        if (outcome.success && outcome.pdfBuffer) {
          const storeStart = performance.now();
          await redis.setex(`${PDF_PREFIX}${jobId}`, RESULT_TTL, outcome.pdfBuffer);
          await redis.expire(`${JOB_PREFIX}${jobId}`, RESULT_TTL);
          timings.storeMs = Math.round(performance.now() - storeStart);
          timings.pdfStoredAt = Date.now();
          timings.totalMs = timings.pdfStoredAt - (timings.requestedAt ?? dequeuedAt);

          await this.markJobCompleted(jobId, {
            success: true,
            duration: outcome.timings.engineMs,
            warnings: undefined,
            logExcerpt: errorExcerpt(outcome.output),
          }, timings);
          console.log('[WORKER] Job ' + jobId + ' completed (' + outcome.pdfBuffer.length + ' bytes, ' + timings.totalMs + 'ms end to end)');
        } else {
          const knownFiles = job.snapshotDigest
            ? (await loadSnapshotBundle(job.snapshotDigest))?.files.map((file) => file.path) ?? [mainFile]
            : [mainFile];
          const diagnostics = parseCompileErrors(outcome.output, knownFiles, mainFile);
          const message = outcome.error || formatCompileError(diagnostics, 'Compilation failed');

          timings.totalMs = Date.now() - (timings.requestedAt ?? dequeuedAt);
          await this.markJobFailed(jobId, message, diagnostics, errorExcerpt(outcome.output), timings);
          await this.releaseClaim(job);
          console.error('[WORKER] Job ' + jobId + ' failed: ' + message.split('\n')[0]);
        }
      } finally {
        if (jobDir) await removeJobDirectory(jobDir);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.markJobFailed(jobId, message, [], '', { completedAt: Date.now() });
      const rawJob = await redis.get(`${JOB_PREFIX}${jobId}`);
      if (rawJob) {
        try {
          await this.releaseClaim(JSON.parse(rawJob) as CompilationJob);
        } catch {
          // nothing else to clean up
        }
      }
      console.error('[WORKER] Failed to process job ' + jobId + ': ' + message);
      throw error;
    } finally {
      await redis.srem(PROCESSING_SET, jobId);
      this.activeJobs.delete(jobId);
    }
  }

  private async releaseClaim(job: CompilationJob): Promise<void> {
    if (!job.snapshotDigest) return;
    const { snapshotJobKey } = await import('../producer/queue');
    const key = snapshotJobKey(job.userId, job.snapshotDigest);
    const current = await redis.get(key);
    if (current === job.id) await redis.del(key);
  }

  private async readStatus(jobId: string): Promise<JobStatusResponse> {
    const raw = await redis.get(`${RESULT_PREFIX}${jobId}`);
    return raw ? (JSON.parse(raw) as JobStatusResponse) : { status: JobStatus.PENDING, createdAt: Date.now() };
  }

  private async writeStatus(jobId: string, status: JobStatus, patch: Partial<JobStatusResponse>): Promise<void> {
    const data = await this.readStatus(jobId);
    data.status = status;
    if (status === JobStatus.PROCESSING) data.processingStartedAt = Date.now();
    const merged: JobStatusResponse = { ...data, ...patch, timings: { ...data.timings, ...patch.timings } };
    await redis.setex(`${RESULT_PREFIX}${jobId}`, RESULT_TTL, JSON.stringify(merged));
  }

  private async markJobCompleted(jobId: string, result: NonNullable<JobStatusResponse['result']>, timings: StageTimings): Promise<void> {
    const data = await this.readStatus(jobId);
    await redis.setex(
      `${RESULT_PREFIX}${jobId}`,
      RESULT_TTL,
      JSON.stringify({
        ...data,
        status: JobStatus.COMPLETED,
        result: { ...result, success: true, pdfUrl: '/api/pdf/' + jobId },
        timings: { ...data.timings, ...timings },
        completedAt: Date.now(),
      } satisfies JobStatusResponse),
    );
  }

  private async markJobFailed(
    jobId: string,
    error: string,
    diagnostics: ReturnType<typeof parseCompileErrors>,
    logExcerpt: string,
    timings: StageTimings,
  ): Promise<void> {
    const data = await this.readStatus(jobId);
    await redis.setex(
      `${RESULT_PREFIX}${jobId}`,
      RESULT_TTL,
      JSON.stringify({
        ...data,
        status: JobStatus.FAILED,
        result: { success: false, error, diagnostics: diagnostics.length ? diagnostics : undefined, logExcerpt: logExcerpt || undefined, duration: 0 },
        timings: { ...data.timings, ...timings },
        completedAt: Date.now(),
      } satisfies JobStatusResponse),
    );
    await redis.expire(`${JOB_PREFIX}${jobId}`, RESULT_TTL);
  }

  private async cleanupStuckJobs(): Promise<void> {
    const processingJobs = await redis.smembers(PROCESSING_SET);
    if (processingJobs.length === 0) return;

    console.log('[WORKER] Found ' + processingJobs.length + ' jobs marked processing');
    for (const jobId of processingJobs) {
      if (this.activeJobs.has(jobId)) continue;
      const data = await this.readStatus(jobId);
      const started = data.processingStartedAt || 0;
      if (Date.now() - started > this.processingTimeout) {
        console.log('[WORKER] Marking stuck job ' + jobId + ' as failed');
        await this.markJobFailed(jobId, 'Job timed out or worker crashed', [], '', { completedAt: Date.now() });
        await redis.srem(PROCESSING_SET, jobId);
      }
    }
  }

  async getStats(): Promise<{ queueLength: number; processingCount: number; concurrency: number; active: number }> {
    const [queueLength, processingCount] = await Promise.all([redis.llen(QUEUE_NAME), redis.scard(PROCESSING_SET)]);
    return { queueLength, processingCount, concurrency: this.concurrency, active: this.activeJobs.size };
  }
}

export const worker = new CompilationWorker();
export { engineVersion, compilerOptionsForCacheKey };

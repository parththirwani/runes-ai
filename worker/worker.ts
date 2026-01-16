
import redis, { QUEUE_NAME, PROCESSING_SET, JOB_PREFIX, PDF_PREFIX, RESULT_TTL, RESULT_PREFIX } from '@/src/lib/redis';
import { JobStatus, CompilationJob } from '@/src/types/compilation';
import { compileLatexToPDF } from './latex-compiler';

export class CompilationWorker {
  private isRunning = false;
  private pollInterval = 1000; // 1 second
  private processingTimeout = 300000; // 5 minutes

  constructor(pollInterval?: number) {
    if (pollInterval) {
      this.pollInterval = pollInterval;
    }
  }

  /**
   * Start the worker
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[WORKER] Already running');
      return;
    }

    this.isRunning = true;
    console.log('[WORKER] Starting worker...');

    // Cleanup any stuck jobs on startup
    await this.cleanupStuckJobs();

    // Start processing loop
    this.processLoop();
  }

  /**
   * Stop the worker
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    console.log('[WORKER] Stopping worker...');
  }

  /**
   * Main processing loop
   */
  private async processLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.processNextJob();
      } catch (error) {
        console.error('[WORKER] Error in process loop:', error);
      }

      // Wait before next iteration
      await new Promise((resolve) => setTimeout(resolve, this.pollInterval));
    }

    console.log('[WORKER] Worker stopped');
  }

  /**
   * Process next job from queue
   */
  private async processNextJob(): Promise<void> {
    // Pop job from queue (blocking operation with timeout)
    const result = await redis.blpop(QUEUE_NAME, 5);

    if (!result) {
      return; // No job available
    }

    const [_, jobId] = result;

    try {
      await this.processJob(jobId);
    } catch (error: any) {
      console.error(`[WORKER] Failed to process job ${jobId}:`, error);
      await this.markJobFailed(jobId, error.message || 'Unknown error');
    }
  }

  /**
   * Process a single job
   */
  private async processJob(jobId: string): Promise<void> {
    console.log(`[WORKER] Processing job ${jobId}`);

    // Mark job as processing
    await redis.sadd(PROCESSING_SET, jobId);
    await this.updateJobStatus(jobId, JobStatus.PROCESSING);

    // Get job data
    const jobData = await redis.get(`${JOB_PREFIX}${jobId}`);

    if (!jobData) {
      throw new Error('Job data not found');
    }

    const job: CompilationJob = JSON.parse(jobData);

    console.log(`[WORKER] Compiling document ${job.slug} for user ${job.userId}`);

    // Compile LaTeX to PDF
    const result = await compileLatexToPDF(
      job.content,
      job.slug,
      { timeout: 90000 }
    );

    // Remove from processing set
    await redis.srem(PROCESSING_SET, jobId);

    if (result.success && result.pdfBuffer) {
      // Store PDF in Redis
      await redis.setex(
        `${PDF_PREFIX}${jobId}`,
        RESULT_TTL,
        result.pdfBuffer
      );

      // Mark job as completed
      await this.markJobCompleted(jobId, {
        success: true,
        duration: result.duration,
        warnings: result.warnings,
      });

      console.log(`[WORKER] Job ${jobId} completed successfully (${result.pdfBuffer.length} bytes, ${result.duration}ms)`);
    } else {
      // Mark job as failed
      await this.markJobFailed(jobId, result.error || 'Compilation failed');
      console.error(`[WORKER] Job ${jobId} failed: ${result.error}`);
    }
  }

  /**
   * Update job status
   */
  private async updateJobStatus(jobId: string, status: JobStatus): Promise<void> {
    const currentData = await redis.get(`${RESULT_PREFIX}${jobId}`);
    const data = currentData ? JSON.parse(currentData) : {};

    data.status = status;

    if (status === JobStatus.PROCESSING) {
      data.processingStartedAt = Date.now();
    }

    await redis.setex(
      `${RESULT_PREFIX}${jobId}`,
      RESULT_TTL,
      JSON.stringify(data)
    );
  }

  /**
   * Mark job as completed
   */
  private async markJobCompleted(jobId: string, result: any): Promise<void> {
    const currentData = await redis.get(`${RESULT_PREFIX}${jobId}`);
    const data = currentData ? JSON.parse(currentData) : {};

    data.status = JobStatus.COMPLETED;
    data.result = result;
    data.completedAt = Date.now();

    await redis.setex(
      `${RESULT_PREFIX}${jobId}`,
      RESULT_TTL,
      JSON.stringify(data)
    );
  }

  /**
   * Mark job as failed
   */
  private async markJobFailed(jobId: string, error: string): Promise<void> {
    const currentData = await redis.get(`${RESULT_PREFIX}${jobId}`);
    const data = currentData ? JSON.parse(currentData) : {};

    data.status = JobStatus.FAILED;
    data.result = {
      success: false,
      error: error,
      duration: 0,
    };
    data.completedAt = Date.now();

    await redis.setex(
      `${RESULT_PREFIX}${jobId}`,
      RESULT_TTL,
      JSON.stringify(data)
    );
  }

  /**
   * Cleanup stuck jobs (jobs that were processing but worker crashed)
   */
  private async cleanupStuckJobs(): Promise<void> {
    const processingJobs = await redis.smembers(PROCESSING_SET);

    if (processingJobs.length === 0) {
      return;
    }

    console.log(`[WORKER] Found ${processingJobs.length} stuck jobs, cleaning up...`);

    for (const jobId of processingJobs) {
      const resultData = await redis.get(`${RESULT_PREFIX}${jobId}`);

      if (resultData) {
        const data = JSON.parse(resultData);
        const timeSinceStart = Date.now() - (data.processingStartedAt || 0);

        // If job has been processing for too long, mark as failed
        if (timeSinceStart > this.processingTimeout) {
          console.log(`[WORKER] Marking stuck job ${jobId} as failed`);
          await this.markJobFailed(jobId, 'Job timed out or worker crashed');
          await redis.srem(PROCESSING_SET, jobId);
        }
      }
    }
  }

  /**
   * Get worker stats
   */
  async getStats(): Promise<{
    queueLength: number;
    processingCount: number;
  }> {
    const queueLength = await redis.llen(QUEUE_NAME);
    const processingCount = await redis.scard(PROCESSING_SET);

    return { queueLength, processingCount };
  }
}

// Singleton instance
export const worker = new CompilationWorker();
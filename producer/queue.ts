import redis, { JOB_PREFIX, RESULT_TTL, QUEUE_NAME, RESULT_PREFIX, PDF_PREFIX } from "@/src/lib/redis";
import { CompilationJob, JobStatus, JobStatusResponse } from "@/src/types/compilation";
import { v4 as uuidv4 } from 'uuid';

export class CompilationProducer {
  /**
   * Add a compilation job to the queue
   */
  async addJob(job: Omit<CompilationJob, 'id' | 'createdAt'>): Promise<string> {
    const jobId = uuidv4();
    const compilationJob: CompilationJob = {
      ...job,
      id: jobId,
      createdAt: Date.now(),
    };

    const pipeline = redis.pipeline();
    
    // Store job data
    pipeline.setex(
      `${JOB_PREFIX}${jobId}`,
      RESULT_TTL,
      JSON.stringify(compilationJob)
    );
    
    // Add job ID to queue
    pipeline.rpush(QUEUE_NAME, jobId);
    
    // Set initial status
    pipeline.setex(
      `${RESULT_PREFIX}${jobId}`,
      RESULT_TTL,
      JSON.stringify({
        status: JobStatus.PENDING,
        createdAt: compilationJob.createdAt,
      })
    );

    await pipeline.exec();
    
    console.log(`[PRODUCER] Job ${jobId} added to queue for document ${job.slug}`);
    return jobId;
  }

  /**
   * Get job status and result
   */
  async getJobStatus(jobId: string): Promise<JobStatusResponse | null> {
    const resultData = await redis.get(`${RESULT_PREFIX}${jobId}`);
    
    if (!resultData) {
      return null;
    }

    return JSON.parse(resultData);
  }

  /**
   * Get PDF buffer if compilation succeeded
   */
  async getPDF(jobId: string): Promise<Buffer | null> {
    const pdfData = await redis.getBuffer(`${PDF_PREFIX}${jobId}`);
    return pdfData;
  }

  /**
   * Get queue length
   */
  async getQueueLength(): Promise<number> {
    return await redis.llen(QUEUE_NAME);
  }

  /**
   * Cancel a pending job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const removed = await redis.lrem(QUEUE_NAME, 1, jobId);
    
    if (removed > 0) {
      await redis.setex(
        `${RESULT_PREFIX}${jobId}`,
        RESULT_TTL,
        JSON.stringify({
          status: JobStatus.FAILED,
          result: {
            success: false,
            error: 'Job cancelled by user',
            duration: 0,
          },
          createdAt: Date.now(),
          completedAt: Date.now(),
        })
      );
      
      console.log(`[PRODUCER] Job ${jobId} cancelled`);
      return true;
    }
    
    return false;
  }
}

export const compilationProducer = new CompilationProducer();
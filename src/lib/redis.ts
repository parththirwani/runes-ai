import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD,  
  db: Number(process.env.REDIS_DB) || 0,
  maxRetriesPerRequest: null,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

export const QUEUE_NAME = 'latex:compilation:queue';
export const PROCESSING_SET = 'latex:compilation:processing';
export const JOB_PREFIX = 'latex:job:';
export const RESULT_PREFIX = 'latex:result:';
export const PDF_PREFIX = 'latex:pdf:';

// TTL for results and PDFs (24 hours)
export const RESULT_TTL = 86400;

redis.on('connect', () => {
  console.log('[REDIS] Connected successfully');
});

redis.on('error', (err) => {
  console.error('[REDIS] Connection error:', err);
});

export default redis;
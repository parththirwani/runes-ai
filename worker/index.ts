import redis from '@/src/lib/redis';
import { worker } from './worker';

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[WORKER] Received SIGTERM signal');
  await worker.stop();
  await redis.quit();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[WORKER] Received SIGINT signal');
  await worker.stop();
  await redis.quit();
  process.exit(0);
});

// Start the worker
(async () => {
  try {
    console.log('[WORKER] Starting LaTeX compilation worker...');
    await worker.start();
  } catch (error) {
    console.error('[WORKER] Failed to start worker:', error);
    process.exit(1);
  }
})();


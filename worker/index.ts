import redis from '@/src/lib/redis';
import { worker } from './worker';
import express from 'express';

const app = express();
const port = process.env.WORKER_PORT || 3001;

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const stats = await worker.getStats();
    res.json({
      status: 'healthy',
      isRunning: worker['isRunning'], // Access private field for health check
      ...stats,
    });
  } catch (error) {
    res.status(500).json({ status: 'unhealthy', error: (error as Error).message });
  }
});

// Start health check server
app.listen(port, () => {
  console.log(`[WORKER] Health check server running on port ${port}`);
});

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
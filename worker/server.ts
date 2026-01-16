import express from 'express';
import { worker } from './worker';

const app = express();
const port = process.env.WORKER_PORT || 3001;

app.get('/health', async (req, res) => {
  try {
    const stats = await worker.getStats();
    res.json({
      status: 'healthy',
      ...stats,
    });
  } catch (error) {
    res.status(500).json({ status: 'unhealthy', error: (error as Error).message });
  }
});

app.listen(port, () => {
  console.log(`[WORKER] Health check server running on port ${port}`);
});
import redis from './redis';

const WINDOW_MS = 60_000;

function withRedisDeadline<T>(operation: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('AI quota storage unavailable')), 1_500);
    operation.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

// One Redis operation prevents concurrent requests from exceeding the quota.
const LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('PTTL', KEYS[1])}
`;

export async function checkAiRateLimit(userId: string, action: 'complete' | 'paraphrase') {
  const max = action === 'complete' ? 60 : 20;
  const key = `latex:ai:${action}:${userId}`;
  const result = await withRedisDeadline(redis.eval(LIMIT_SCRIPT, 1, key, WINDOW_MS)) as [number, number];
  return {
    allowed: result[0] <= max,
    retryAfter: Math.max(1, Math.ceil(result[1] / 1000)),
  };
}

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

export async function acquireAiSlot(userId: string, action: 'complete' | 'paraphrase'): Promise<(() => Promise<void>) | null> {
  const key = `latex:ai:active:${action}:${userId}`;
  const token = crypto.randomUUID();
  const acquired = await withRedisDeadline(redis.set(key, token, 'PX', 20_000, 'NX'));
  if (acquired !== 'OK') return null;
  return async () => {
    await withRedisDeadline(redis.eval(RELEASE_SCRIPT, 1, key, token)).catch(() => undefined);
  };
}

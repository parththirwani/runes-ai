import redis from './redis';

export const RATE_LIMIT_PREFIX = 'latex:ratelimit:';
export const RATE_LIMIT_WINDOW = 60; // 1 minute in seconds
export const RATE_LIMIT_MAX_REQUESTS = 10;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  error?: string;
}

/**
 * Check if a request is allowed based on rate limits
 * Uses a sliding window counter approach
 * 
 * @param documentId - The document ID to rate limit
 * @param maxRequests - Maximum requests allowed (default: 10)
 * @param windowSeconds - Time window in seconds (default: 60)
 * @returns RateLimitResult with allowed status and metadata
 */
export async function checkRateLimit(
  documentId: string,
  maxRequests: number = RATE_LIMIT_MAX_REQUESTS,
  windowSeconds: number = RATE_LIMIT_WINDOW
): Promise<RateLimitResult> {
  const key = `${RATE_LIMIT_PREFIX}${documentId}`;
  const now = Date.now();
  const windowStart = now - (windowSeconds * 1000);

  try {
    // Use Redis pipeline for atomic operations
    const pipeline = redis.pipeline();

    // Remove old entries outside the window
    pipeline.zremrangebyscore(key, 0, windowStart);

    // Count current requests in window
    pipeline.zcard(key);

    // Add current request timestamp
    pipeline.zadd(key, now, `${now}-${Math.random()}`);

    // Set expiry on the key
    pipeline.expire(key, windowSeconds);

    const results = await pipeline.exec();

    if (!results) {
      throw new Error('Redis pipeline failed');
    }

    // Get count before adding current request
    const currentCount = results[1][1] as number;

    const allowed = currentCount < maxRequests;
    const remaining = Math.max(0, maxRequests - currentCount - 1);
    const resetAt = now + (windowSeconds * 1000);

    if (!allowed) {
      // Remove the request we just added since it's not allowed
      await redis.zpopmax(key);
      
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        error: `Rate limit exceeded. Maximum ${maxRequests} compilations per ${windowSeconds} seconds.`
      };
    }

    return {
      allowed: true,
      remaining,
      resetAt
    };

  } catch (error: any) {
    console.error('[RATE_LIMIT] Error checking rate limit:', error);
    // On error, allow the request but log it
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetAt: now + (windowSeconds * 1000),
      error: 'Rate limit check failed, allowing request'
    };
  }
}

/**
 * Get current rate limit status without incrementing
 */
export async function getRateLimitStatus(
  documentId: string,
  maxRequests: number = RATE_LIMIT_MAX_REQUESTS,
  windowSeconds: number = RATE_LIMIT_WINDOW
): Promise<RateLimitResult> {
  const key = `${RATE_LIMIT_PREFIX}${documentId}`;
  const now = Date.now();
  const windowStart = now - (windowSeconds * 1000);

  try {
    // Remove old entries and count current
    await redis.zremrangebyscore(key, 0, windowStart);
    const currentCount = await redis.zcard(key);

    const allowed = currentCount < maxRequests;
    const remaining = Math.max(0, maxRequests - currentCount);
    const resetAt = now + (windowSeconds * 1000);

    return {
      allowed,
      remaining,
      resetAt,
      error: allowed ? undefined : `Rate limit would be exceeded`
    };

  } catch (error: any) {
    console.error('[RATE_LIMIT] Error getting rate limit status:', error);
    return {
      allowed: true,
      remaining: maxRequests,
      resetAt: now + (windowSeconds * 1000)
    };
  }
}

/**
 * Reset rate limit for a document (admin function)
 */
export async function resetRateLimit(documentId: string): Promise<void> {
  const key = `${RATE_LIMIT_PREFIX}${documentId}`;
  await redis.del(key);
  console.log(`[RATE_LIMIT] Reset rate limit for document ${documentId}`);
}
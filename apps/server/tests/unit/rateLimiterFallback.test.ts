import { describe, expect, it, vi } from 'vitest';
import { RateLimiterRes } from 'rate-limiter-flexible';

// A Redis that never answers: nothing listens on port 1, and the client neither queues nor retries.
vi.mock('../../src/utils/redis', async () => {
  const { default: Redis } = await import('ioredis');
  const client = new Redis({
    host: '127.0.0.1',
    port: 1,
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  client.on('error', () => {});
  return { getRedisClient: () => client, closeRedis: async () => client.disconnect() };
});

import { createLimiter } from '../../src/middleware/rateLimiter';

describe('a limiter whose Redis does not answer (scan B)', () => {
  it('keeps counting in memory, with the same limit, instead of letting every request through', async () => {
    const limiter = createLimiter('rl:test-fallback', 3, 60);
    for (let i = 0; i < 3; i += 1) {
      await expect(limiter.consume('someone')).resolves.toBeInstanceOf(RateLimiterRes);
    }
    await expect(limiter.consume('someone')).rejects.toBeInstanceOf(RateLimiterRes);
    await expect(limiter.consume('someone-else')).resolves.toBeInstanceOf(RateLimiterRes);
  });
});

import Redis from 'ioredis';
import { config } from '../config';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis | null {
  if (!config.redis.enabled) return null;
  if (redisClient) return redisClient;

  try {
    redisClient = new Redis(config.redis.url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    redisClient.on('error', (err) => {
      console.warn('Redis connection error (rate limiter will use memory fallback):', err.message);
    });

    redisClient.connect().catch(() => {
      // Handled by error event; getRedisClient returns the instance
      // and rate-limiter-flexible handles connection failures gracefully
    });

    return redisClient;
  } catch {
    console.warn('Failed to create Redis client, using memory fallback');
    return null;
  }
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

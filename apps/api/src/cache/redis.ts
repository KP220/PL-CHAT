import { Redis } from 'ioredis';
import { env } from '../config/env.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 2,
  enableReadyCheck: true,
  lazyConnect: true
});

export const redisSubscriber = redis.duplicate();

export async function connectRedis() {
  await Promise.all([redis.connect(), redisSubscriber.connect()]);
}

export async function disconnectRedis() {
  await Promise.allSettled([redis.quit(), redisSubscriber.quit()]);
}

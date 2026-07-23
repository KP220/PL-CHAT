import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/prisma.js';
import { redis } from '../cache/redis.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ ok: true, service: 'pl-chat-api' }));

  app.get('/ready', async (_request, reply) => {
    await prisma.$queryRaw`SELECT 1`;
    const pong = await redis.ping();
    if (pong !== 'PONG') return reply.code(503).send({ ok: false, redis: pong });
    return { ok: true };
  });
}

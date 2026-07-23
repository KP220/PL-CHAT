import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashToken } from '../auth/tokens.js';
import { prisma } from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const deviceSchema = z.object({
  platform: z.enum(['ios', 'android', 'web']),
  pushToken: z.string().min(20).max(4096)
});

export async function notificationRoutes(app: FastifyInstance) {
  app.post('/notification-devices', { preHandler: requireAuth }, async (request, reply) => {
    const body = deviceSchema.parse(request.body);
    const device = await prisma.notificationDevice.upsert({
      where: {
        userId_pushTokenHash: {
          userId: request.auth!.userId,
          pushTokenHash: hashToken(body.pushToken)
        }
      },
      update: { platform: body.platform, enabled: true },
      create: {
        userId: request.auth!.userId,
        platform: body.platform,
        pushTokenHash: hashToken(body.pushToken)
      }
    });

    return reply.code(201).send({ id: device.id, platform: device.platform, enabled: device.enabled });
  });

  app.get('/notifications', { preHandler: requireAuth }, async (request) => {
    const query = z.object({
      cursor: z.string().cuid().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30)
    }).parse(request.query);

    return prisma.notification.findMany({
      where: { userId: request.auth!.userId },
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit,
      orderBy: { createdAt: 'desc' }
    });
  });

  app.post('/notifications/:notificationId/read', { preHandler: requireAuth }, async (request) => {
    const params = z.object({ notificationId: z.string().cuid() }).parse(request.params);
    await prisma.notification.updateMany({
      where: { id: params.notificationId, userId: request.auth!.userId },
      data: { readAt: new Date() }
    });
    return { ok: true };
  });
}

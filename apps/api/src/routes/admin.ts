import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { redis } from '../cache/redis.js';
import { requireAdmin } from '../middleware/admin.js';

const moderationSchema = z.object({
  locked: z.boolean().optional(),
  deleted: z.boolean().optional(),
  note: z.string().trim().max(1000).optional()
});

async function audit(actorId: string, action: string, targetType: string, targetId: string, metadata: unknown, ipAddress?: string) {
  await prisma.adminAuditLog.create({
    data: { actorId, action, targetType, targetId, metadata: metadata as object, ipAddress }
  });
}

export async function adminRoutes(app: FastifyInstance) {
  app.get('/admin/overview', { preHandler: requireAdmin }, async () => {
    const [users, rooms, messages, openReports] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.chatRoom.count({ where: { deletedAt: null } }),
      prisma.message.count({ where: { deletedAt: null } }),
      prisma.report.count({ where: { status: { in: ['OPEN', 'REVIEWING'] } } })
    ]);
    const redisStatus = await redis.ping().catch(() => 'DOWN');
    return { users, rooms, messages, openReports, redis: redisStatus };
  });

  app.get('/admin/users', { preHandler: requireAdmin }, async (request) => {
    const query = z.object({
      q: z.string().trim().max(120).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50)
    }).parse(request.query);

    return prisma.user.findMany({
      where: query.q
        ? {
            OR: [
              { email: { contains: query.q, mode: 'insensitive' } },
              { profile: { displayName: { contains: query.q, mode: 'insensitive' } } },
              { profile: { username: { contains: query.q, mode: 'insensitive' } } }
            ]
          }
        : undefined,
      take: query.limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        lockedAt: true,
        deletedAt: true,
        createdAt: true,
        profile: true
      }
    });
  });

  app.patch('/admin/users/:userId/moderation', { preHandler: requireAdmin }, async (request) => {
    const params = z.object({ userId: z.string().cuid() }).parse(request.params);
    const body = moderationSchema.parse(request.body);
    const data = {
      lockedAt: body.locked === undefined ? undefined : body.locked ? new Date() : null,
      deletedAt: body.deleted === undefined ? undefined : body.deleted ? new Date() : null
    };
    const user = await prisma.user.update({ where: { id: params.userId }, data, select: { id: true, lockedAt: true, deletedAt: true } });
    await audit(request.auth!.userId, 'user.moderation', 'user', params.userId, body, request.ip);
    return user;
  });

  app.get('/admin/audit-logs', { preHandler: requireAdmin }, async (request) => {
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50)
    }).parse(request.query);

    return prisma.adminAuditLog.findMany({
      take: query.limit,
      orderBy: { createdAt: 'desc' },
      include: { actor: { include: { profile: true } } }
    });
  });
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';

const createReportSchema = z.object({
  reportedUserId: z.string().cuid().optional(),
  roomId: z.string().cuid().optional(),
  messageId: z.string().cuid().optional(),
  reason: z.string().trim().min(3).max(1000)
});

const updateReportSchema = z.object({
  status: z.enum(['OPEN', 'REVIEWING', 'RESOLVED', 'REJECTED']),
  moderatorNote: z.string().trim().max(2000).optional()
});

export async function reportRoutes(app: FastifyInstance) {
  app.post('/reports', { preHandler: requireAuth }, async (request, reply) => {
    const body = createReportSchema.parse(request.body);
    const report = await prisma.report.create({
      data: { ...body, reporterId: request.auth!.userId }
    });
    return reply.code(201).send(report);
  });

  app.get('/admin/reports', { preHandler: requireAdmin }, async (request) => {
    const query = z.object({
      status: z.enum(['OPEN', 'REVIEWING', 'RESOLVED', 'REJECTED']).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50)
    }).parse(request.query);

    return prisma.report.findMany({
      where: query.status ? { status: query.status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      include: {
        reporter: { include: { profile: true } },
        reportedUser: { include: { profile: true } },
        room: true,
        message: true
      }
    });
  });

  app.patch('/admin/reports/:reportId', { preHandler: requireAdmin }, async (request) => {
    const params = z.object({ reportId: z.string().cuid() }).parse(request.params);
    const body = updateReportSchema.parse(request.body);
    const report = await prisma.report.update({
      where: { id: params.reportId },
      data: body
    });
    await prisma.adminAuditLog.create({
      data: {
        actorId: request.auth!.userId,
        action: 'report.update',
        targetType: 'report',
        targetId: report.id,
        metadata: body,
        ipAddress: request.ip
      }
    });
    return report;
  });
}

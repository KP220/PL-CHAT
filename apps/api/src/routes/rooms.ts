import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const createRoomSchema = z.object({
  type: z.enum(['DIRECT', 'GROUP', 'CHANNEL']).default('GROUP'),
  title: z.string().trim().min(1).max(120).optional(),
  memberIds: z.array(z.string().cuid()).max(100).default([])
});

const updateRoomSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  avatarUrl: z.string().url().max(2048).nullable().optional()
});

async function canManageRoom(roomId: string, userId: string) {
  const member = await prisma.groupMember.findUnique({
    where: { roomId_userId: { roomId, userId } }
  });
  return Boolean(member && !member.leftAt && ['OWNER', 'ADMIN'].includes(member.role));
}

export async function roomRoutes(app: FastifyInstance) {
  app.get('/rooms', { preHandler: requireAuth }, async (request) => {
    const userId = request.auth!.userId;
    return prisma.chatRoom.findMany({
      where: { deletedAt: null, members: { some: { userId, leftAt: null } } },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: {
        members: { where: { leftAt: null }, include: { user: { include: { profile: true } } } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 }
      }
    });
  });

  app.post('/rooms', { preHandler: requireAuth }, async (request, reply) => {
    const body = createRoomSchema.parse(request.body);
    const userId = request.auth!.userId;
    const uniqueMemberIds = [...new Set([userId, ...body.memberIds])];

    const room = await prisma.chatRoom.create({
      data: {
        type: body.type,
        title: body.title,
        members: {
          create: uniqueMemberIds.map((memberId) => ({
            userId: memberId,
            role: memberId === userId ? 'OWNER' : 'MEMBER'
          }))
        }
      },
      include: { members: true }
    });

    return reply.code(201).send(room);
  });

  app.patch('/rooms/:roomId', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ roomId: z.string().cuid() }).parse(request.params);
    const body = updateRoomSchema.parse(request.body);
    const userId = request.auth!.userId;

    if (!(await canManageRoom(params.roomId, userId))) {
      return reply.code(403).send({ error: 'room_admin_required' });
    }

    return prisma.chatRoom.update({
      where: { id: params.roomId },
      data: body,
      include: {
        members: { where: { leftAt: null }, include: { user: { include: { profile: true } } } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 }
      }
    });
  });
}

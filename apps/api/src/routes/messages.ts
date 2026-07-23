import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const cursorSchema = z.object({
  cursor: z.string().cuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

const createMessageSchema = z.object({
  roomId: z.string().cuid(),
  clientNonce: z.string().min(8).max(120),
  body: z.string().trim().min(1).max(8000).optional(),
  encryptedBody: z.string().max(20000).optional(),
  type: z.enum(['TEXT', 'IMAGE', 'FILE', 'VOICE', 'VIDEO']).default('TEXT')
}).refine((value) => value.body || value.encryptedBody, {
  message: 'body_or_encrypted_body_required'
});

const editMessageSchema = z.object({ body: z.string().trim().min(1).max(8000) });
const reactionSchema = z.object({ emoji: z.string().min(1).max(32) });
const searchSchema = z.object({
  q: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

async function assertRoomMember(roomId: string, userId: string) {
  const member = await prisma.groupMember.findUnique({
    where: { roomId_userId: { roomId, userId } }
  });
  return Boolean(member && !member.leftAt);
}

export async function messageRoutes(app: FastifyInstance) {
  app.get('/rooms/:roomId/messages', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ roomId: z.string().cuid() }).parse(request.params);
    const query = cursorSchema.parse(request.query);
    const userId = request.auth!.userId;

    if (!(await assertRoomMember(params.roomId, userId))) {
      return reply.code(403).send({ error: 'room_access_denied' });
    }

    return prisma.message.findMany({
      where: { roomId: params.roomId, deletedAt: null },
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        sender: { include: { profile: true } },
        attachments: true,
        reactions: true
      }
    });
  });

  app.post('/messages', { preHandler: requireAuth }, async (request, reply) => {
    const body = createMessageSchema.parse(request.body);
    const userId = request.auth!.userId;

    if (!(await assertRoomMember(body.roomId, userId))) {
      return reply.code(403).send({ error: 'room_access_denied' });
    }

    const message = await prisma.message.upsert({
      where: { senderId_clientNonce: { senderId: userId, clientNonce: body.clientNonce } },
      update: {},
      create: {
        roomId: body.roomId,
        senderId: userId,
        clientNonce: body.clientNonce,
        body: body.body,
        encryptedBody: body.encryptedBody,
        type: body.type
      },
      include: { sender: { include: { profile: true } }, attachments: true, reactions: true }
    });

    return reply.code(201).send(message);
  });

  app.patch('/messages/:messageId', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ messageId: z.string().cuid() }).parse(request.params);
    const body = editMessageSchema.parse(request.body);
    const userId = request.auth!.userId;

    const message = await prisma.message.updateMany({
      where: { id: params.messageId, senderId: userId, deletedAt: null },
      data: { body: body.body, editedAt: new Date() }
    });
    if (!message.count) return reply.code(404).send({ error: 'message_not_found' });
    return { ok: true };
  });

  app.delete('/messages/:messageId', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ messageId: z.string().cuid() }).parse(request.params);
    const userId = request.auth!.userId;
    const message = await prisma.message.updateMany({
      where: { id: params.messageId, senderId: userId, deletedAt: null },
      data: { deletedAt: new Date(), body: null, encryptedBody: null }
    });
    if (!message.count) return reply.code(404).send({ error: 'message_not_found' });
    return { ok: true };
  });

  app.post('/messages/:messageId/reactions', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ messageId: z.string().cuid() }).parse(request.params);
    const body = reactionSchema.parse(request.body);
    const userId = request.auth!.userId;

    await prisma.messageReaction.upsert({
      where: { messageId_userId_emoji: { messageId: params.messageId, userId, emoji: body.emoji } },
      update: {},
      create: { messageId: params.messageId, userId, emoji: body.emoji }
    });
    return reply.code(201).send({ ok: true });
  });

  app.delete('/messages/:messageId/reactions', { preHandler: requireAuth }, async (request) => {
    const params = z.object({ messageId: z.string().cuid() }).parse(request.params);
    const body = reactionSchema.parse(request.body);
    await prisma.messageReaction.deleteMany({
      where: { messageId: params.messageId, userId: request.auth!.userId, emoji: body.emoji }
    });
    return { ok: true };
  });

  app.post('/messages/:messageId/read', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ messageId: z.string().cuid() }).parse(request.params);
    const userId = request.auth!.userId;
    const message = await prisma.message.findUnique({ where: { id: params.messageId }, select: { roomId: true } });
    if (!message) return reply.code(404).send({ error: 'message_not_found' });
    if (!(await assertRoomMember(message.roomId, userId))) return reply.code(403).send({ error: 'room_access_denied' });

    await prisma.readReceipt.upsert({
      where: { messageId_userId: { messageId: params.messageId, userId } },
      update: { readAt: new Date() },
      create: { messageId: params.messageId, userId }
    });
    return { ok: true };
  });

  app.get('/rooms/:roomId/messages/search', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ roomId: z.string().cuid() }).parse(request.params);
    const query = searchSchema.parse(request.query);
    const userId = request.auth!.userId;

    if (!(await assertRoomMember(params.roomId, userId))) {
      return reply.code(403).send({ error: 'room_access_denied' });
    }

    return prisma.message.findMany({
      where: {
        roomId: params.roomId,
        deletedAt: null,
        body: { contains: query.q, mode: 'insensitive' }
      },
      take: query.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        sender: { include: { profile: true } },
        attachments: true,
        reactions: true
      }
    });
  });
}

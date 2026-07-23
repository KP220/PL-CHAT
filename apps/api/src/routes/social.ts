import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const userIdParams = z.object({ userId: z.string().cuid() });

export async function socialRoutes(app: FastifyInstance) {
  app.post('/users/:userId/follow', { preHandler: requireAuth }, async (request, reply) => {
    const params = userIdParams.parse(request.params);
    const followerId = request.auth!.userId;
    if (params.userId === followerId) return reply.code(400).send({ error: 'cannot_follow_self' });

    await prisma.follow.upsert({
      where: { followerId_followingId: { followerId, followingId: params.userId } },
      update: {},
      create: { followerId, followingId: params.userId }
    });
    return reply.code(201).send({ ok: true });
  });

  app.delete('/users/:userId/follow', { preHandler: requireAuth }, async (request) => {
    const params = userIdParams.parse(request.params);
    await prisma.follow.deleteMany({
      where: { followerId: request.auth!.userId, followingId: params.userId }
    });
    return { ok: true };
  });

  app.post('/users/:userId/friend-request', { preHandler: requireAuth }, async (request, reply) => {
    const params = userIdParams.parse(request.params);
    const requesterId = request.auth!.userId;
    if (params.userId === requesterId) return reply.code(400).send({ error: 'cannot_friend_self' });

    await prisma.friendship.upsert({
      where: { requesterId_addresseeId: { requesterId, addresseeId: params.userId } },
      update: { status: 'PENDING' },
      create: { requesterId, addresseeId: params.userId }
    });
    return reply.code(201).send({ ok: true });
  });

  app.post('/friends/:requesterId/accept', { preHandler: requireAuth }, async (request) => {
    const params = z.object({ requesterId: z.string().cuid() }).parse(request.params);
    await prisma.friendship.updateMany({
      where: { requesterId: params.requesterId, addresseeId: request.auth!.userId, status: 'PENDING' },
      data: { status: 'ACCEPTED' }
    });
    return { ok: true };
  });

  app.get('/me/social', { preHandler: requireAuth }, async (request) => {
    const userId = request.auth!.userId;
    const [following, followers, friends] = await Promise.all([
      prisma.follow.findMany({ where: { followerId: userId }, include: { following: { include: { profile: true } } } }),
      prisma.follow.findMany({ where: { followingId: userId }, include: { follower: { include: { profile: true } } } }),
      prisma.friendship.findMany({
        where: { OR: [{ requesterId: userId }, { addresseeId: userId }], status: 'ACCEPTED' },
        include: {
          requester: { include: { profile: true } },
          addressee: { include: { profile: true } }
        }
      })
    ]);

    return { following, followers, friends };
  });
}

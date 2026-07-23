import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_.-]+$/)
    .transform((value) => value.toLowerCase())
    .optional(),
  avatarUrl: z.string().url().max(2048).nullable().optional(),
  coverUrl: z.string().url().max(2048).nullable().optional(),
  bio: z.string().trim().max(300).nullable().optional(),
  publicLink: z.string().trim().max(160).nullable().optional(),
  statusText: z.string().trim().max(120).nullable().optional()
});

export async function profileRoutes(app: FastifyInstance) {
  app.get('/me/profile', { preHandler: requireAuth }, async (request) => {
    return prisma.user.findUniqueOrThrow({
      where: { id: request.auth!.userId },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        profile: true
      }
    });
  });

  app.patch('/me/profile', { preHandler: requireAuth }, async (request) => {
    const body = profileUpdateSchema.parse(request.body);
    return prisma.userProfile.upsert({
      where: { userId: request.auth!.userId },
      update: body,
      create: {
        userId: request.auth!.userId,
        displayName: body.displayName || request.auth!.email.split('@')[0],
        username: body.username || request.auth!.email.split('@')[0].toLowerCase(),
        avatarUrl: body.avatarUrl,
        coverUrl: body.coverUrl,
        bio: body.bio,
        publicLink: body.publicLink,
        statusText: body.statusText
      }
    });
  });

  app.get('/users/:userId/profile', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ userId: z.string().cuid() }).parse(request.params);
    const user = await prisma.user.findFirst({
      where: { id: params.userId, deletedAt: null },
      select: {
        id: true,
        createdAt: true,
        profile: true,
        _count: {
          select: {
            memberships: true,
            sentMessages: true
          }
        }
      }
    });

    if (!user) return reply.code(404).send({ error: 'user_not_found' });
    return user;
  });
}

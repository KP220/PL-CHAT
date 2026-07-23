import argon2 from 'argon2';
import { randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { hashToken, signAccessToken, signRefreshToken, verifyRefreshToken } from '../auth/tokens.js';
import { requireAuth } from '../middleware/auth.js';
import { isProduction } from '../config/env.js';

const emailSchema = z.string().email().max(320).transform((email) => email.toLowerCase());
const passwordSchema = z.string().min(10).max(256);

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(80)
});

const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  deviceName: z.string().trim().max(120).optional()
});

const refreshSchema = z.object({ refreshToken: z.string().min(20) });
const verifyEmailSchema = z.object({
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/)
});

function safeUsername(email: string) {
  const prefix = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 20) || 'user';
  return `${prefix}-${Date.now().toString(36)}`;
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id });
    const verificationCode = String(randomInt(100000, 1000000));

    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash,
        profile: { create: { displayName: body.displayName, username: safeUsername(body.email) } },
        emailVerifications: {
          create: {
            codeHash: hashToken(verificationCode),
            expiresAt: new Date(Date.now() + 15 * 60 * 1000)
          }
        }
      },
      select: { id: true, email: true, role: true }
    });

    return reply.code(201).send({
      user,
      verificationRequired: true,
      previewVerificationCode: isProduction ? undefined : verificationCode
    });
  });

  app.post('/auth/verify-email', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const body = verifyEmailSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || user.deletedAt) return reply.code(404).send({ error: 'user_not_found' });

    const verification = await prisma.emailVerification.findFirst({
      where: {
        userId: user.id,
        purpose: 'signup',
        consumedAt: null,
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!verification) return reply.code(400).send({ error: 'verification_expired' });
    if (verification.attempts >= 5) return reply.code(429).send({ error: 'too_many_attempts' });
    if (verification.codeHash !== hashToken(body.code)) {
      await prisma.emailVerification.update({
        where: { id: verification.id },
        data: { attempts: { increment: 1 } }
      });
      return reply.code(400).send({ error: 'invalid_verification_code' });
    }

    await prisma.$transaction([
      prisma.emailVerification.update({ where: { id: verification.id }, data: { consumedAt: new Date() } }),
      prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } })
    ]);

    return { ok: true };
  });

  app.post('/auth/login', { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || user.deletedAt) return reply.code(401).send({ error: 'invalid_credentials' });
    if (!user.emailVerifiedAt) return reply.code(403).send({ error: 'email_not_verified' });
    if (user.lockedAt) return reply.code(423).send({ error: 'account_locked' });

    const validPassword = await argon2.verify(user.passwordHash, body.password);
    if (!validPassword) return reply.code(401).send({ error: 'invalid_credentials' });

    const session = await prisma.session.create({
      data: {
        userId: user.id,
        deviceName: body.deviceName,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent']
      }
    });

    const accessToken = await signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      sessionId: session.id
    });
    const refreshToken = await signRefreshToken(session.id);
    await prisma.session.update({
      where: { id: session.id },
      data: { refreshTokenHash: hashToken(refreshToken) }
    });

    return { accessToken, refreshToken, user: { id: user.id, email: user.email, role: user.role } };
  });

  app.post('/auth/refresh', async (request, reply) => {
    const body = refreshSchema.parse(request.body);
    const { sessionId } = await verifyRefreshToken(body.refreshToken);
    const session = await prisma.session.findUnique({ where: { id: sessionId }, include: { user: true } });

    if (!session || session.revokedAt || session.refreshTokenHash !== hashToken(body.refreshToken)) {
      return reply.code(401).send({ error: 'invalid_refresh_token' });
    }

    const refreshToken = await signRefreshToken(session.id);
    await prisma.session.update({
      where: { id: session.id },
      data: { refreshTokenHash: hashToken(refreshToken), lastSeenAt: new Date() }
    });

    const accessToken = await signAccessToken({
      sub: session.user.id,
      email: session.user.email,
      role: session.user.role,
      sessionId: session.id
    });

    return { accessToken, refreshToken };
  });

  app.post('/auth/logout', { preHandler: requireAuth }, async (request) => {
    await prisma.session.updateMany({
      where: { id: request.auth?.sessionId, userId: request.auth?.userId },
      data: { revokedAt: new Date(), refreshTokenHash: null }
    });
    return { ok: true };
  });
}

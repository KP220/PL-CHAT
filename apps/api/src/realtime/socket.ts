import { createAdapter } from '@socket.io/redis-adapter';
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { redis, redisSubscriber } from '../cache/redis.js';
import { prisma } from '../db/prisma.js';
import { verifyAccessToken } from '../auth/tokens.js';

type ClientMessage = {
  roomId: string;
  clientNonce: string;
  body?: string;
  encryptedBody?: string;
};

export function createSocketServer(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.PUBLIC_ORIGIN, credentials: true },
    transports: ['websocket'],
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 128 * 1024
  });

  io.adapter(createAdapter(redis, redisSubscriber));

  io.use(async (socket, next) => {
    try {
      const token = String(socket.handshake.auth?.token || '');
      const auth = await verifyAccessToken(token);
      socket.data.auth = auth;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const auth = socket.data.auth as Awaited<ReturnType<typeof verifyAccessToken>>;
    socket.join(`user:${auth.userId}`);
    await redis.set(`presence:${auth.userId}`, 'online', 'EX', 60);

    socket.on('room:join', async ({ roomId }: { roomId: string }, ack?: (value: unknown) => void) => {
      const member = await prisma.groupMember.findUnique({
        where: { roomId_userId: { roomId, userId: auth.userId } }
      });
      if (!member || member.leftAt) return ack?.({ ok: false, error: 'room_access_denied' });
      socket.join(`room:${roomId}`);
      ack?.({ ok: true });
    });

    socket.on('typing:start', ({ roomId }: { roomId: string }) => {
      socket.to(`room:${roomId}`).emit('typing:start', { roomId, userId: auth.userId });
    });

    socket.on('message:send', async (payload: ClientMessage, ack?: (value: unknown) => void) => {
      try {
        const rateKey = `rate:socket:message:${auth.userId}`;
        const count = await redis.incr(rateKey);
        if (count === 1) await redis.expire(rateKey, 60);
        if (count > env.SOCKET_MAX_MESSAGES_PER_MINUTE) {
          return ack?.({ ok: false, error: 'rate_limited' });
        }

        const member = await prisma.groupMember.findUnique({
          where: { roomId_userId: { roomId: payload.roomId, userId: auth.userId } }
        });
        if (!member || member.leftAt) return ack?.({ ok: false, error: 'room_access_denied' });

        const message = await prisma.message.upsert({
          where: { senderId_clientNonce: { senderId: auth.userId, clientNonce: payload.clientNonce } },
          update: {},
          create: {
            roomId: payload.roomId,
            senderId: auth.userId,
            clientNonce: payload.clientNonce,
            body: payload.body?.slice(0, 8000),
            encryptedBody: payload.encryptedBody,
            type: 'TEXT'
          },
          include: { sender: { include: { profile: true } }, attachments: true, reactions: true }
        });

        io.to(`room:${payload.roomId}`).emit('message:new', message);
        ack?.({ ok: true, message });
      } catch (error) {
        logger.error({ error }, 'Failed to send socket message');
        ack?.({ ok: false, error: 'message_send_failed' });
      }
    });

    socket.on('disconnect', async () => {
      await redis.set(`presence:${auth.userId}`, 'offline', 'EX', 120);
    });
  });

  return io;
}

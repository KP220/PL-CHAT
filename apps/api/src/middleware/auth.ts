import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken } from '../auth/tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: {
      userId: string;
      email: string;
      role: string;
      sessionId: string;
    };
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';

  if (!token) {
    await reply.code(401).send({ error: 'missing_access_token' });
    return;
  }

  try {
    request.auth = await verifyAccessToken(token);
  } catch {
    await reply.code(401).send({ error: 'invalid_access_token' });
  }
}

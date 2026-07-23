import type { FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth } from './auth.js';

const adminRoles = new Set(['MODERATOR', 'ADMIN', 'SUPER_ADMIN']);

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await requireAuth(request, reply);
  if (reply.sent) return;
  if (!request.auth || !adminRoles.has(request.auth.role)) {
    await reply.code(403).send({ error: 'admin_required' });
  }
}

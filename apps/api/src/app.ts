import fastify from 'fastify';
import { registerSecurity } from './middleware/security.js';
import { logger } from './config/logger.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { roomRoutes } from './routes/rooms.js';
import { messageRoutes } from './routes/messages.js';
import { reportRoutes } from './routes/reports.js';
import { profileRoutes } from './routes/profiles.js';
import { notificationRoutes } from './routes/notifications.js';
import { adminRoutes } from './routes/admin.js';
import { socialRoutes } from './routes/social.js';
import { metricsRoutes } from './routes/metrics.js';

export async function buildApp() {
  const app = fastify({
    loggerInstance: logger as any,
    bodyLimit: 1_000_000,
    trustProxy: true
  });

  app.setErrorHandler((error, request, reply) => {
    const appError = error as Error & { statusCode?: number; code?: string; issues?: unknown };
    request.log.error({ error }, 'Request failed');
    if (Array.isArray(appError.issues)) {
      return reply.code(400).send({ error: 'validation_failed', issues: appError.issues });
    }
    return reply.code(appError.statusCode || 500).send({ error: appError.code || 'internal_error' });
  });

  await registerSecurity(app);
  await metricsRoutes(app);
  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/api' });
  await app.register(roomRoutes, { prefix: '/api' });
  await app.register(messageRoutes, { prefix: '/api' });
  await app.register(reportRoutes, { prefix: '/api' });
  await app.register(profileRoutes, { prefix: '/api' });
  await app.register(notificationRoutes, { prefix: '/api' });
  await app.register(adminRoutes, { prefix: '/api' });
  await app.register(socialRoutes, { prefix: '/api' });

  return app;
}

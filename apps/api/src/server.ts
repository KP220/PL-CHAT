import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectRedis, disconnectRedis } from './cache/redis.js';
import { disconnectPrisma } from './db/prisma.js';
import { buildApp } from './app.js';
import { createSocketServer } from './realtime/socket.js';

async function main() {
  await connectRedis();
  const app = await buildApp();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  createSocketServer(app.server);

  logger.info({ port: env.PORT }, 'PL CHAT API started');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Graceful shutdown started');
    await app.close();
    await disconnectRedis();
    await disconnectPrisma();
    logger.info('Graceful shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled promise rejection');
    process.exit(1);
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ error }, 'Uncaught exception');
    process.exit(1);
  });
}

void main().catch((error) => {
  logger.fatal({ error }, 'Failed to start API');
  process.exit(1);
});

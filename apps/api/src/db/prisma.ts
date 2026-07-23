import { Prisma, PrismaClient } from '@prisma/client';
import { logger } from '../config/logger.js';

export const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' }
  ]
});

prisma.$on('error', (event: Prisma.LogEvent) => logger.error({ event }, 'Prisma error'));
prisma.$on('warn', (event: Prisma.LogEvent) => logger.warn({ event }, 'Prisma warning'));

export async function disconnectPrisma() {
  await prisma.$disconnect();
}

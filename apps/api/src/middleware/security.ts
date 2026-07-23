import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { env, isProduction } from '../config/env.js';

export async function registerSecurity(app: FastifyInstance) {
  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: isProduction
      ? {
          directives: {
            defaultSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'https:'],
            mediaSrc: ["'self'", 'https:'],
            connectSrc: ["'self'", env.PUBLIC_ORIGIN],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"]
          }
        }
      : false
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || origin === env.PUBLIC_ORIGIN) {
        callback(null, true);
        return;
      }
      callback(new Error('origin_not_allowed'), false);
    },
    credentials: true
  });

  await app.register(rateLimit, {
    max: 600,
    timeWindow: '1 minute',
    ban: 3
  });

  await app.register(sensible);
}

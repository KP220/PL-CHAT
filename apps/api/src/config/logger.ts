import pino from 'pino';
import { isProduction } from './env.js';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',

  redact: {
    paths: [
      'req.headers.authorization',
      'password',
      'passwordHash',
      'refreshToken'
    ],
    remove: true
  },

  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          singleLine: true
        }
      }
});
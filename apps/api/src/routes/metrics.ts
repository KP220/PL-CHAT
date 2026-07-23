import type { FastifyInstance } from 'fastify';
import client from 'prom-client';

const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'plchat_' });

const httpRequests = new client.Counter({
  name: 'plchat_http_requests_total',
  help: 'Total HTTP requests handled by PL CHAT API',
  labelNames: ['method', 'route', 'status']
});

const httpDuration = new client.Histogram({
  name: 'plchat_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5]
});

register.registerMetric(httpRequests);
register.registerMetric(httpDuration);

export async function metricsRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    request.startTime = process.hrtime.bigint();
  });

  app.addHook('onResponse', async (request, reply) => {
    const startTime = request.startTime;
    if (!startTime) return;
    const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000_000;
    const route = request.routeOptions.url || request.url.split('?')[0];
    const labels = { method: request.method, route, status: String(reply.statusCode) };
    httpRequests.inc(labels);
    httpDuration.observe(labels, duration);
  });

  app.get('/metrics', async (_request, reply) => {
    reply.header('Content-Type', register.contentType);
    return register.metrics();
  });
}

declare module 'fastify' {
  interface FastifyRequest {
    startTime?: bigint;
  }
}

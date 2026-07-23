# PL CHAT Deployment Guide

## Local Production-Like Run

1. Copy `apps/api/.env.example` to `apps/api/.env`.
2. Set strong JWT secrets and `POSTGRES_PASSWORD`.
3. Run PostgreSQL, Redis, and API with Docker Compose:

```bash
docker compose -f docker-compose.production.yml up --build
```

4. Run migrations inside the API container:

```bash
docker compose -f docker-compose.production.yml exec api npm run prisma:migrate
```

The same compose file now starts:

- PostgreSQL
- Redis
- Fastify API with Socket.IO
- Next.js web/admin dashboard

## Kubernetes

1. Build and push `apps/api/Dockerfile` to your registry.
2. Create `pl-chat-api-secrets` with database, Redis, JWT, and public origin values.
3. Apply manifests:

```bash
kubectl apply -f infra/k8s/api-deployment.yaml
kubectl apply -f infra/k8s/web-deployment.yaml
kubectl apply -f infra/k8s/hpa.yaml
```

## Edge And CDN

- Put Cloudflare in front of NGINX.
- Enable WAF managed rules, bot fight mode, rate limiting for `/api/auth/*`, and WebSocket support.
- Serve user media through object storage signed URLs and CDN cache rules.

## Backup

- Run `infra/backup/postgres-backup.sh` from a scheduled job with encrypted storage.
- Test restore before launch and after every schema milestone.

## Observability

Start Prometheus and Grafana:

```bash
docker compose -f docker-compose.production.yml -f docker-compose.observability.yml up -d
```

- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3001`
- API metrics: `/metrics`

## Load Test

Install k6, then run:

```bash
k6 run -e PLCHAT_API_URL=http://localhost:8787 load-tests/k6-chat.js
```

Targets before public beta:

- HTTP error rate below 1%
- p95 message persistence below 300 ms in the test environment
- p95 REST latency below 500 ms
- No process crash during reconnect or registration spikes

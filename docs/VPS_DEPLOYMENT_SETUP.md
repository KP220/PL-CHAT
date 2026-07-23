# VPS Deployment Setup

Use VPS deployment when PL CHAT is ready for a stable internal organization rollout.

Minimum production shape:

- VPS with Docker Compose
- Domain or subdomain
- Nginx reverse proxy
- Let's Encrypt HTTPS
- PostgreSQL
- Redis
- Persistent upload storage
- Automated database backups
- Process monitoring and restart policy

Email links must use the public HTTPS domain in `APP_PUBLIC_URL`.

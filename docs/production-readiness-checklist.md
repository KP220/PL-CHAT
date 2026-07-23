# PL CHAT Production Readiness Checklist

## Launch Blockers

- Real auth API with verified email or OTP.
- Refresh token rotation and device session revocation.
- Realtime message persistence and delivery acknowledgements.
- Rate limiting for REST, auth, socket connect, and message send.
- Media upload validation and private object storage.
- Admin dashboard for reports, bans, room moderation, and audit logs.
- Public profile APIs, follow/friend relationships, and room rename permission checks.
- Backup and restore test for PostgreSQL.
- Error logging and crash reporting wired to production.

## Required Tests

- Auth: signup, login, refresh rotation, logout, session revoke, invalid token.
- Chat: one-to-one send, group send, duplicate idempotency key, edit, delete, reactions, read receipts.
- Realtime: reconnect, offline replay, typing expiry, presence expiry, multi-device delivery.
- Profiles: update avatar, username uniqueness, visibility rules, follow/friend graph, blocked-user privacy.
- Security: brute force, upload abuse, oversized payloads, forbidden room access, report abuse.
- Performance: websocket fanout, message pagination, search latency, Redis outage behavior, PostgreSQL slow query audit.
- Load: run `load-tests/k6-chat.js` before each public beta release.

## First Production Limits

- Start with conservative defaults: 5 MB images, 100 MB videos/files, 30 messages/min/user, 10 socket connects/min/IP.
- Increase limits only after monitoring real traffic and storage costs.
- Keep E2EE fields in the schema from day one, even if plaintext preview mode is used during alpha.

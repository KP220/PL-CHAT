# Presence System

## Statuses

- `online`
- `away`
- `busy`
- `offline`

## Trial Logic

- When a user logs in or opens an event stream, the server marks them online.
- The browser sends a heartbeat every 30 seconds.
- If the latest heartbeat is older than 90 seconds, the user is shown as offline.
- If the latest heartbeat is older than 5 minutes, the user is shown as away.
- Users can manually select online, away, busy, or auto.
- `lastSeenAt` and `lastHeartbeatAt` are stored in local trial state.

## API Routes

- `GET /api/presence`
- `POST /api/presence/heartbeat`
- `PATCH /api/presence/status`

## Realtime Updates

The trial server broadcasts `presence:update` over Server-Sent Events and also refreshes via polling fallback.

## Production Direction

For production, move presence to Redis with short TTL keys and persist durable `lastSeenAt` values to PostgreSQL. This keeps online status fast without writing to the database every few seconds.

# PL CHAT Phase C: DB Repository Layer

Phase C adds an optional database read layer for the current PL CHAT runtime while keeping JSON as the default source.

## Default behavior

```env
PL_CHAT_DATA_READ_MODE="json"
```

The runtime keeps reading from `pl-chat-data/pl-chat-workspace.json`. This is the safest mode for the current internal rollout.

## Test database reads

After Phase B migration/import has completed in the test database, you can test read-only DB access with:

```env
DATABASE_URL="postgresql://plchat_phaseb_user:plchat_phaseb_password@localhost:5432/plchat_phaseb"
PL_CHAT_DATA_READ_MODE="dual"
```

In `dual` mode, selected read endpoints try PostgreSQL first and automatically fall back to JSON if the database is unavailable.

## Current DB-backed read endpoints

- `GET /api/health` reports repository status.
- `GET /api/rooms` can read conversations from PostgreSQL.
- `GET /api/files` can read universal file metadata from PostgreSQL.
- `GET /api/notifications` can read notifications from PostgreSQL.

Write operations still use JSON in this phase. This prevents live runtime breakage while the repository layer is introduced gradually.

## Safety rules

- Keep `PL_CHAT_DATA_READ_MODE="json"` for normal production use until DB reads are verified.
- Use `dual` only during controlled testing.
- Do not use `db` as a hard requirement until write paths and session storage are moved to PostgreSQL.
- Keep JSON backups until DB read/write parity is proven.

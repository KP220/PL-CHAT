# PL CHAT Chat Attachment Retention Policy

## Purpose

Chat attachments can consume a large amount of local disk space. PL CHAT now supports a server-side retention policy for chat-room attachments:

- New chat attachments are downloadable for 72 hours by default.
- After the download window expires, download, preview, thumbnail, share, legacy `/uploads/...`, and signed-download access are blocked with `410 file_download_expired`.
- Expired local chat attachments are permanently removed from `pl-chat-data/uploads` by a scheduled cleanup job.
- Metadata and audit history remain, so old messages can still show that an attachment existed.

This policy is for PL CHAT-managed chat attachments only. It must not be used to rewrite or optimize Quick Tunnel / Cloudflare transfer behavior.

## Configuration

Environment variables:

- `CHAT_ATTACHMENT_RETENTION_ENABLED=true`
- `CHAT_ATTACHMENT_DOWNLOAD_EXPIRES_HOURS=72`
- `CHAT_ATTACHMENT_DELETE_GRACE_HOURS=0`
- `CHAT_ATTACHMENT_RETENTION_BATCH_SIZE=100`
- `CHAT_ATTACHMENT_RETENTION_INTERVAL_MINUTES=60`

The default policy means a chat file is available for 3 days, then becomes delete-eligible immediately. The scheduled job starts 60 seconds after server startup and then runs every configured interval.

## Admin APIs

Check current retention summary:

```text
GET /api/admin/storage/retention
```

Preview what would be deleted without changing files:

```text
POST /api/admin/storage/retention/run
{ "limit": 100 }
```

Run cleanup:

```text
POST /api/admin/storage/retention/run
{ "execute": true, "limit": 100 }
```

## Safety Rules

- Cleanup only removes local files whose resolved path stays inside `pl-chat-data/uploads`.
- Cleanup removes matching thumbnails only when the thumbnail path stays inside `pl-chat-data/thumbnails`.
- Profile files and post files are not included in the chat attachment retention policy.
- S3/MinIO objects are not deleted by this local-disk cleanup path.
- Deleted files keep metadata with `retentionStatus`, `downloadExpiresAt`, `deleteAfterAt`, and `purgedAt`.

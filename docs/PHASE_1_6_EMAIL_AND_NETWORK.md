# Archived: Phase 1.6 Email And Network

This document is retained as implementation history. Production configuration is tracked in the Phase 1.7 production conversion report.

Phase 1.6 upgrades the PL CHAT small-group trial from console-only verification into a real email-link flow that is ready to connect to SMTP and a public HTTPS URL.

## Implemented In Trial Server

- Register creates the user immediately with `emailVerifiedAt = null`.
- The server creates a random verification token, stores only its SHA-256 hash, and sends a verification link.
- Verification links use `/verify-email?token=...`.
- Login is blocked until email is verified, unless `EMAIL_VERIFICATION_REQUIRED=false`.
- Resend verification uses a generic response and a simple rate guard.
- Forgot/reset password uses hashed, expiring, one-time tokens.
- Admin invite sends `/invite/accept?token=...` links.
- Admin SMTP test endpoint is available at `POST /api/admin/email/test`.
- Email logs store metadata only, never SMTP passwords or raw tokens.

## Important Policy

For staging or private production, set:

```env
APP_ENV=staging
APP_PUBLIC_URL=https://your-public-domain.example
```

Do not use `localhost`, `127.0.0.1`, `192.168.x.x`, or plain HTTP for email links outside local testing.

## Current Readiness

The code path is implemented. Real inbox delivery still requires valid SMTP credentials and a public HTTPS URL.

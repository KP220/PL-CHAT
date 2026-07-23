# Archived: Phase 1.6 Completion Report

This report is retained as implementation history and is not production user-facing copy.

## Summary

Phase 1.6 has been added to the PL CHAT small-group trial. The trial server now supports real email-link verification architecture, password reset, invite links, SMTP testing, public URL configuration, and documentation.

## Email Verification Status

Implemented with hashed, expiring, one-time verification tokens.

## SMTP Provider/Config Status

Supported through env variables in `trial-server/.env.trial`. Real inbox delivery requires valid SMTP credentials.

## Password Reset Status

Implemented with hashed, expiring, one-time reset tokens.

## Invite User Status

Implemented for trial admins. The first registered user is treated as admin.

## Public URL / HTTPS Status

Implemented through `APP_PUBLIC_URL`. Actual external access requires Cloudflare Tunnel or a VPS/domain.

## Network Access Test Result

Local smoke testing can verify the server. External 4G/5G testing must be done after a public HTTPS URL is configured.

## Inbox Deliverability Result

Not fully verified until SMTP, SPF, DKIM, and DMARC are configured for a real sender domain.

## Security Checks

- Raw tokens are not stored.
- SMTP password is only read from env.
- Reset and verification tokens expire and are one-time use.
- Forgot password responses are generic.
- Email logs do not store email body or secrets.

## Files Changed

- `trial-server/server.mjs`
- `trial-server/public/index.html`
- `trial-server/.env.trial.example`
- `scripts/windows-start-small-group-trial.ps1`
- `apps/api/prisma/schema.prisma`
- Phase 1.6 documentation files

## Env Variables Added

- `APP_ENV`
- `APP_PUBLIC_URL`
- `EMAIL_VERIFICATION_REQUIRED`
- `EMAIL_VERIFICATION_EXPIRES_MINUTES`
- `PASSWORD_RESET_EXPIRES_MINUTES`
- `INVITE_EXPIRES_DAYS`
- `SMTP_PASSWORD`
- `SMTP_REQUIRE_TLS`

## Known Issues

Real inbox delivery and public mobile access are not proven until SMTP and public HTTPS are configured on this machine or a server.

## Recommendation Before Phase 2

Configure SMTP and Cloudflare Tunnel first, then run a 3-5 user test from different networks.

## Final Decision

READY FOR PHASE 2 WITH WARNINGS

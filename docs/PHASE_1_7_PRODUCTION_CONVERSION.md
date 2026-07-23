# Phase 1.7 Production Conversion

## Safety Status

- `git status` was checked first.
- The working folder was not a git repository, so a local git repository was initialized.
- Branch pointer is now `production-conversion-pl-chat`.
- Important env/config files were backed up under `.backups/phase-1.7-*`.
- No database migration was executed.
- Existing legacy local-run files were not deleted.

## Search Classification

### A. User-Facing Changed

These production-visible surfaces were updated to PL CHAT production wording:

- Browser title: `PL CHAT Internal Workspace`
- Header subtitle: `Internal Workspace`
- Default room: `PL CHAT Internal Workspace`
- Default system welcome message: `Welcome to PL CHAT Internal Workspace.`
- Server health service name: `pl-chat-internal-workspace`
- Server error copy: `PL CHAT server error.`
- PowerShell startup copy: `PL CHAT Internal Workspace`
- Desktop preview email copy no longer says demo/test code.
- README production email section now uses internal workspace wording.

### B. Developer-Only Kept Or Archived

Historical docs and local-run notes still mention earlier phases. They are now marked as archived:

- `docs/small-group-trial-guide.md`
- `docs/PHASE_1_5_COLLABORATION.md`
- `docs/PHASE_1_5_COMPLETION_REPORT.md`
- `docs/PHASE_1_6_EMAIL_AND_NETWORK.md`
- `docs/PHASE_1_6_COMPLETION_REPORT.md`

Package lock and TypeScript build-info references are generated developer artifacts and are not user-facing.

### C. Config/ENV Mapping

Current compatibility mapping:

| Legacy/local name | Production name | Status |
| --- | --- | --- |
| `PL_CHAT_TRIAL_PORT` | `PL_CHAT_PORT` | Production name preferred; legacy fallback kept |
| `PL_CHAT_TRIAL_HOST` | `PL_CHAT_HOST` | Production name preferred; legacy fallback kept |
| `PL_CHAT_TRIAL_MAX_JSON_MB` | `PL_CHAT_MAX_JSON_MB` | Production name preferred; legacy fallback kept |
| `PL_CHAT_TRIAL_MAX_UPLOAD_MB` | `PL_CHAT_MAX_UPLOAD_MB` | Production name preferred; legacy fallback kept |
| `trial-data` | `pl-chat-data` | Production default when `APP_ENV=production`; local default remains compatible |
| `trial-server/.env.trial` | `.env.production` | Production launcher reads `.env.production`; legacy file retained |
| `scripts/windows-start-small-group-trial.*` | `scripts/windows-start-pl-chat-production.*` | Production launcher added; legacy launcher retained |

## Environment Files

Added/updated:

- `.env.example`
- `.env.production.example`
- `.env.local.example`
- `trial-server/.env.trial.example` as a legacy local config reference

## Production Run Command

```powershell
cd "C:\Users\PC\Documents\Codex\2026-05-28\ios"
copy .env.production.example .env.production
.\scripts\windows-start-pl-chat-production.cmd
```

Before real internal rollout, replace every `change-me`, set `APP_PUBLIC_URL` to the real HTTPS domain, configure SMTP, and use PostgreSQL for production persistence.

## Result

PL CHAT has been converted from user-facing trial wording to production internal workspace wording without deleting legacy local-run files.

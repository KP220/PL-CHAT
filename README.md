# PL CHAT

PL CHAT is an internal organization chat workspace with realtime messaging, rooms, private chat, profiles, file sharing, email verification, notifications, and an AI assistant integration path.

## Production Internal Workspace

Use the production launcher for the real internal PL CHAT workspace:

```powershell
cd "C:\Users\PC\Documents\Codex\2026-05-28\ios"
copy .env.production.example .env.production
.\scripts\windows-start-pl-chat-production.cmd
```

Before internal rollout, edit `.env.production`:

- Set `APP_PUBLIC_URL` to the real HTTPS domain.
- Replace all `change-me` secrets.
- Configure PostgreSQL in `DATABASE_URL`.
- Configure SMTP so verification, reset password, and invite emails go to real inboxes.
- Keep OpenAI API keys on the server only.

## Environment Files

- `.env.example`: complete template for PL CHAT.
- `.env.production.example`: production internal workspace template.
- `.env.local.example`: local developer template.
- `trial-server/.env.trial.example`: legacy local-run compatibility reference only.

## Current Server Entry

The current local server implementation still lives at `trial-server/server.mjs` for compatibility. Production wording and production environment variables are now used by the production launcher.

## Useful Commands

```bash
npm run plchat:workspace
npm run plchat:production
npm run plchat:tunnel
npm run desktop:dev
npm run desktop:package
npm run desktop:win
npm run typecheck
```

## Windows Desktop App

The PL CHAT desktop app is an Electron shell that connects to the real PL CHAT workspace rather than a separate static preview.

- Local development defaults to `http://localhost:8788`.
- Set `PL_CHAT_DESKTOP_URL` when launching the app to override the workspace URL.
- For a packaged organization build, copy `electron/desktop-config.example.json` to `electron/desktop-config.json` and set the stable HTTPS PL CHAT domain before running `npm run desktop:win`.
- Do not put passwords, tokens, SMTP credentials, or API keys in `desktop-config.json`.

Desktop Phase D1 includes a secure isolated renderer, single-instance behavior, remembered window size, System Tray controls, close-to-tray preference, start-with-Windows preference, blocked unsafe navigation, and an offline retry screen.

## Documentation

- `docs/PHASE_1_7_PRODUCTION_CONVERSION.md`
- `docs/SMTP_SETUP.md`
- `docs/EMAIL_DELIVERABILITY.md`
- `docs/PUBLIC_NETWORK_DEPLOYMENT.md`
- `docs/CLOUDFLARE_TUNNEL_SETUP.md`
- `docs/VPS_DEPLOYMENT_SETUP.md`
- `docs/PHASE_C_DB_REPOSITORY_LAYER.md`
- `docs/production-readiness-checklist.md`

## Production Rule

Do not expose PL CHAT to real organization users until secrets, SMTP, public HTTPS, database persistence, backups, and access policy are configured and verified.

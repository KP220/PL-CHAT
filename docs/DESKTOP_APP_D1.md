# PL CHAT Desktop Phase D1

## Scope

Phase D1 upgrades the existing Electron wrapper into a secure Windows desktop shell for the real PL CHAT workspace.

Included:

- Production workspace URL loading
- Single running app instance
- Remembered window size, position, and maximized state
- System Tray with open, notification, Do Not Disturb, close-to-tray, start-with-Windows, and quit controls
- Safe external-link handling and same-origin workspace navigation
- Offline connection screen with retry
- Isolated preload bridge with no renderer Node.js access
- Native Windows notifications with click-through routing to the related PL CHAT target

Not included yet:

- Desktop download manager and progress UI
- `plchat://` deep links
- Auto update

## Workspace URL

Resolution order:

1. `PL_CHAT_DESKTOP_URL`
2. `APP_PUBLIC_URL`
3. Bundled `electron/desktop-config.json`
4. `http://localhost:8788`

Only HTTP and HTTPS URLs are accepted. Use a stable HTTPS domain for organization deployment.

To prepare a bundled domain configuration:

```powershell
Copy-Item electron\desktop-config.example.json electron\desktop-config.json
```

Then edit only the public `appUrl`. Never add secrets to this file.

## Commands

```powershell
npm run desktop:dev
npm run desktop:package
npm run desktop:win
```

## Rollback

The web application and server are unchanged. If a desktop build fails, users can continue using PL CHAT in a browser. The previous Electron files can also be restored independently without a database migration.

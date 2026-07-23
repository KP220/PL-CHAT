# PL CHAT LAN v1 Phase 1 + Phase 2

Goal: make PL CHAT LAN v1 stable enough for daily internal team use before adding remote access or automatic updates.

## Phase 1: Stabilize LAN v1

### Host checklist

- Host computer stays awake during working hours.
- Host LAN IP is fixed at `192.168.1.126`.
- PL CHAT server is listening on `0.0.0.0:8788`.
- Windows Firewall allows inbound TCP `8788` on Private network.
- Client browser can open `http://192.168.1.126:8788/api/health`.
- Backup is taken before inviting more users.

### Client smoke test

Run this on at least 3 real client computers.

- Clean install PL CHAT.
- Open from the normal `PL CHAT` desktop shortcut.
- Sign in.
- Send and receive chat messages.
- Send one image and one file.
- Receive a desktop notification.
- Close and reopen PL CHAT.
- Restart Windows and open PL CHAT again.

### Hold criteria

Do not roll out to the whole team if any of these happen:

- A client cannot reach `/api/health`.
- PL CHAT opens only through a debug `.cmd`.
- A client returns to `localhost:8788`.
- Chat, file transfer, or notifications fail on two or more client computers.

## Phase 2: Installer hardening

Version `1.0.1` includes installer-side cleanup for LAN clients:

- The installer writes `%APPDATA%\pl-chat\desktop-server.json`.
- The installer points clients to `http://192.168.1.126:8788`.
- The installer removes legacy `%APPDATA%\PL CHAT` data.
- The app ignores stale saved loopback URLs such as `localhost` and `127.0.0.1`.
- GPU acceleration is disabled for better compatibility on older Windows clients.
- The app opens a visible window immediately instead of waiting for the web page to finish loading.

## Release package

Send the release folder or zip containing:

- `PL CHAT Setup 1.0.1.exe`
- `SHA256.txt`
- Client install steps
- Emergency server URL fixer
- Debug runner for support cases

## Support escalation

If a user still cannot open PL CHAT:

1. Confirm they installed `1.0.1`.
2. Confirm `/api/health` works in their browser.
3. Collect `%APPDATA%\pl-chat\desktop-startup.log`.
4. Run the debug helper and collect the generated report.

# PL CHAT LAN v1 Phase 3 + Phase 4

## Phase 3: Manual LAN Update System

The host serves a desktop update manifest from:

```text
PL_CHAT_DATA_DIR/desktop-updates/latest.json
```

The latest installer is stored in the same folder. Clients check:

```text
/api/desktop/update-manifest
```

If `latestVersion` is newer than the installed desktop app version and the installer file exists, the Software Update page shows that an update is available. Users download the installer from:

```text
/api/desktop/update-installer
```

This phase is manual install only. The user downloads the setup file, closes PL CHAT, and runs the installer.

### Publish an update

Run this on the host after building a new installer:

```powershell
scripts\windows-publish-desktop-update.ps1 -InstallerPath "C:\path\to\PL CHAT Setup 1.0.2.exe" -Version 1.0.2 -ReleaseNotes "LAN update"
```

Admins can also publish from the Admin page:

1. Open Admin.
2. Go to Host Admin Panel.
3. In Release Manager, enter the new version, for example `1.0.2`.
4. Choose the new `PL CHAT Setup ... .exe`.
5. Click Publish installer.

The server copies the installer into `desktop-updates`, calculates SHA256, and updates `latest.json`.

## Phase 4: Host Admin Panel

Admins can open the Admin page and see:

- Current LAN URLs and port
- Connected desktop/web clients
- Latest desktop installer version and availability
- Update folder path
- Backup folder path

Admin actions:

- Download latest installer
- Publish a new installer from the browser
- Export a JSON data backup
- Record a restart request marker

The restart button does not force-kill the process. It writes `restart-request.json` so the host operator can restart the Windows service or PowerShell process deliberately.

## Required smoke test

- Publish an installer to the host update folder.
- Open PL CHAT Desktop client.
- Go to Software Update.
- Confirm latest version and SHA256 are visible.
- Download the installer from the host.
- Open Admin page as admin.
- Confirm LAN URL, port, connected clients, update folder, and backup folder are visible.
- Publish an installer from Release Manager and confirm latest version changes.
- Create a backup and confirm a backup JSON appears in the backup folder.

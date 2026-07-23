# PL CHAT Desktop Phase D2

Phase D2 upgrades PL CHAT Desktop behavior so it feels closer to a real always-on chat app on Windows.

## Completed

- Keep PL CHAT running in the Windows tray when the window is minimized or closed.
- Open PL CHAT again from the tray icon with click or double-click.
- Show native Windows notifications from PL CHAT.
- Route notification clicks back into the correct PL CHAT target.
- Expose desktop preferences to the web UI.
- Add a Desktop App settings panel in PL CHAT Settings.
- Keep Windows startup and tray behavior enabled by default during install/update.

## User Test Steps

1. Run `scripts\windows-apply-desktop-icon-autostart.cmd`.
2. Open PL CHAT from the desktop shortcut.
3. Open Settings and confirm the Desktop App panel appears.
4. Turn on:
   - Start with Windows
   - Hide to tray when minimized or closed
   - Desktop notifications
5. Click Test desktop notification.
6. Click the Windows notification and confirm PL CHAT opens the notification target.
7. Minimize PL CHAT and confirm it stays in the tray.
8. Close PL CHAT with `X` and confirm it stays in the tray.
9. Restart Windows and confirm PL CHAT starts automatically.

## Notes

- Windows can cache shortcut icons. If an old shortcut icon remains visible, run `scripts\windows-force-refresh-pl-chat-shortcut-icons.cmd`, then press F5 on the desktop or restart Windows once.
- The app does not store the user's password for auto-login. It relies on the existing PL CHAT session token, so users remain signed in like a normal desktop chat app.

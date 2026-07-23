# PL CHAT Desktop LAN-only v1 Release

This release mode is for users on the same Wi-Fi/LAN as the host computer. It does not use Cloudflare Quick Tunnel and it does not include automatic desktop updates.

## Host computer

1. Keep the host computer awake while PL CHAT is in use.
2. Reserve a stable LAN IP in the router, for example `192.168.1.50`.
3. Start PL CHAT Server on `0.0.0.0:8788`.
4. Allow inbound TCP port `8788` on the Windows Private network profile.
5. Prepare the desktop config:

```powershell
scripts\windows-prepare-lan-v1-host.ps1 -HostIp 192.168.1.50 -Port 8788 -OpenFirewall
```

The client URL should look like:

```text
http://192.168.1.50:8788
```

## Build

Use the Windows desktop build command after preparing the host config:

```powershell
npm.cmd run desktop:win
```

Distribute the generated installer, not `release\win-unpacked`.

## Client computer

1. Connect to the same Wi-Fi/LAN as the host.
2. Install PL CHAT.
3. If the offline screen appears, enter the host URL, for example `http://192.168.1.50:8788`, then choose Save Server URL.

The same setting can be written manually:

```powershell
scripts\windows-set-desktop-lan-server.ps1 -AppUrl http://192.168.1.50:8788
```

## Update policy for v1

LAN-only v1 uses manual installer updates:

1. Admin builds a new `PL CHAT Setup x.y.z.exe`.
2. Users close PL CHAT.
3. Users run the new installer.
4. Users reopen PL CHAT.

The Software Update page intentionally reports manual installer mode so users do not expect automatic updates.

## Release checklist

- Host IP is stable.
- `http://HOST-IP:8788/api/health` works from a client computer.
- Windows Firewall allows port `8788` on Private network only.
- Desktop installer is generated.
- A clean client computer can install, sign in, chat, upload/download files, close, and reopen.
- Backup has been taken before inviting users.


# Cloudflare Tunnel Setup

Use this path when you want a fast public HTTPS URL without opening router ports.

1. Install Cloudflare Tunnel:

```powershell
winget install --id Cloudflare.cloudflared -e
```

2. Start PL CHAT locally:

```powershell
cd "C:\Users\PC\Documents\Codex\2026-05-28\ios"
.\scripts\windows-start-small-group-trial.cmd
```

3. In another PowerShell window, start the tunnel:

```powershell
.\scripts\windows-start-public-tunnel.cmd
```

4. Put the public HTTPS URL into `trial-server/.env.trial` as `APP_PUBLIC_URL`.

For a stable domain, create a named tunnel in Cloudflare and route a subdomain to `http://localhost:8788`.

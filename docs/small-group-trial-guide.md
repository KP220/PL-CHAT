# Archived: PL CHAT Early Local Run Guide

This document is kept for historical local-run reference only. It is not the production PL CHAT Internal Workspace guide.

This mode lets a small group test real signup, email-code verification, login, profiles, and realtime chat before paying for cloud hosting.

## Start

Run this on the Windows computer that will act as the temporary server:

```powershell
cd "C:\Users\PC\Documents\Codex\2026-05-28\ios"
.\scripts\windows-start-small-group-trial.cmd
```

Keep the PowerShell window open while testing.

## Invite Testers

The PowerShell window prints local network links such as:

```text
http://192.168.1.144:8788
http://localhost:8788
```

People on the same Wi-Fi can open the `192.168.x.x` link in Chrome, Edge, Safari, Android, iPhone, Windows, or macOS.

## Signup Flow

1. The tester registers with name, personal email, and password.
2. If SMTP is configured, PL CHAT sends the 6-digit code by email.
3. If SMTP is not configured, PL CHAT prints the code in the server PowerShell window.
4. The tester verifies the email and logs in.
5. Messages sync in realtime while the server window stays open.

## Real Email Verification

Copy the SMTP example file:

```powershell
copy "C:\Users\PC\Documents\Codex\2026-05-28\ios\trial-server\.env.trial.example" "C:\Users\PC\Documents\Codex\2026-05-28\ios\trial-server\.env.trial"
```

Edit `.env.trial` and fill in your SMTP provider values:

```text
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your-email@gmail.com
```

Restart the trial server after editing this file. Verification codes are still printed in PowerShell as a backup.

## New Trial Features

- Create group rooms from the left sidebar.
- Start private chats from the user list.
- Upload images, documents, design files, archives, videos, audio, and other file types with a message.
- Every attachment has an open link and a download link. Browser preview depends on whether the user's device supports that file type.
- Edit display name, avatar URL, and profile bio.
- Realtime sync uses Server-Sent Events on local Wi-Fi and polling fallback for public tunnel links.

## Public Test Link Outside Wi-Fi

Cloudflare Quick Tunnel can expose the local trial server through a temporary public URL.

Install `cloudflared` once:

```powershell
winget install --id Cloudflare.cloudflared -e
```

Keep the trial server running in one PowerShell window, then open a second PowerShell window and run:

```powershell
cd "C:\Users\PC\Documents\Codex\2026-05-28\ios"
.\scripts\windows-start-public-tunnel.cmd
```

Cloudflare will print a temporary `trycloudflare.com` URL. Share that URL with testers outside your Wi-Fi.

Important: Quick Tunnel is for testing only, not production. For a permanent public launch, use a named Cloudflare Tunnel with a domain and a real hosted database/server.

## Data Location

Trial data is stored locally here:

```text
C:\Users\PC\Documents\Codex\2026-05-28\ios\trial-data\pl-chat-small-group.json
```

This file contains trial users, password hashes, sessions, and messages. Keep it private.

## Limits

- This is for a small trusted test group on the same Wi-Fi or private network.
- Public tunnel mode is for short tests only.
- File uploads are stored on this computer, so keep backups if testers upload anything important.
- It is not ready for large public traffic.
- OpenAI Assistant, push notifications, app-store releases, and production moderation still need the production backend/cloud phase.

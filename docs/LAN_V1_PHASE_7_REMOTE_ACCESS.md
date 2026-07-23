# PL CHAT LAN v1 Phase 7 Remote Access

Do this only after LAN v1 is stable.

## Direction

Use a fixed Cloudflare Tunnel, not Quick Tunnel.

## Required external items

- Cloudflare account
- Domain name
- Named tunnel
- Stable public hostname, for example `chat.example.com`
- HTTPS
- Access policy or extra auth layer

## Implementation plan

1. Create a named Cloudflare Tunnel on the host.
2. Point a fixed hostname to `http://localhost:8788`.
3. Set `APP_PUBLIC_URL=https://chat.example.com`.
4. Keep `PL_CHAT_LAN_ONLY=true` for LAN builds.
5. Create a separate Remote build profile only after security review.
6. Add client config mode: LAN / Remote.
7. Add admin-visible environment status: LAN-only, Remote, Tunnel hostname.

## Hold criteria

- Do not expose Quick Tunnel URLs to the full team.
- Do not disable LAN-only mode without HTTPS and access controls.
- Do not reuse the LAN installer as the remote installer until config mode exists.

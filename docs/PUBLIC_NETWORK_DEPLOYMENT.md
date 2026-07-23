# Public Network Deployment

PL CHAT can be opened outside the same Wi-Fi only when the server has a public HTTPS URL.

Local URLs such as `localhost`, `127.0.0.1`, and `192.168.x.x` are only for local or LAN testing.

Recommended path for PL CHAT internal rollout:

1. Use Cloudflare Tunnel with a real domain/subdomain.
2. Set `APP_PUBLIC_URL=https://your-subdomain.example`.
3. Restart the PL CHAT server.
4. Register a new test user and confirm the email link uses the public HTTPS URL.

For long-term production, move to VPS or managed cloud with Docker, PostgreSQL, object storage, backups, and monitoring.

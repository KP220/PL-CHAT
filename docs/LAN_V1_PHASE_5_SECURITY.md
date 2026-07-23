# PL CHAT LAN v1 Phase 5 Security Baseline

## Implemented baseline

- LAN-only access is enabled by default with `PL_CHAT_LAN_ONLY=true`.
- Requests from non-private IP ranges are blocked before API/static handling.
- Localhost and private ranges are allowed:
  - `127.0.0.1`
  - `10.0.0.0/8`
  - `172.16.0.0/12`
  - `192.168.0.0/16`
  - `169.254.0.0/16`
- Admin host APIs require login and admin role.
- Email verification remains enabled by default.
- Host backup and restart-marker actions are added to the audit log.

## Operator checklist

- Keep Windows Firewall port `8788` on Private profile only.
- Do not set `PL_CHAT_LAN_ONLY=false` unless using a secured fixed tunnel with HTTPS and extra access control.
- Review Admin > Host Admin Panel weekly.
- Export backup daily before inviting more users.
- Review recent audit entries after any incident.

## Still required before sensitive production use

- Strong password policy UI.
- Session/device management page for admins.
- Admin audit export filtering by user/action/date.
- HTTPS for remote use.
- Signed installer and executable.

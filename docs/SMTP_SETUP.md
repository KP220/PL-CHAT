# SMTP Setup

PL CHAT sends email verification links through SMTP when `.env.production` has valid SMTP values.

On Windows, run the guided setup:

```powershell
.\scripts\windows-configure-smtp.cmd
```

The script asks for the SMTP values and writes them into `.env.production`, which is ignored by Git.

For manual setup, copy `.env.production.example` to `.env.production`, then fill in SMTP values.

```env
APP_ENV=local
APP_PUBLIC_URL=http://localhost:8788
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_REQUIRE_TLS=true
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM="PL CHAT <your-email@gmail.com>"
EMAIL_VERIFICATION_REQUIRED=true
```

For staging or production, `APP_PUBLIC_URL` must be a real HTTPS URL.

## Gmail Notes

Use a Google App Password, not your normal Gmail password.

Recommended Gmail values:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_REQUIRE_TLS=true
```

If Gmail blocks the login, enable 2-Step Verification on the Google account and create an App Password for PL CHAT.

## Test

1. Restart PL CHAT with `.\scripts\windows-start-pl-chat-production.cmd`.
2. Register a new account with a personal email.
3. Check the inbox and spam folder for the verification link.
4. Admin users can also click `Test SMTP to my email` in PL CHAT.

## Provider Notes

The same variables work for Zoho, SendGrid SMTP, Mailgun SMTP, Amazon SES SMTP, or an organization mail server.

Do not commit `.env.production`, `.env.local`, or any file that contains SMTP secrets.

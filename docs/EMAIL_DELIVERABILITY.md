# Email Deliverability

To make verification email arrive in inbox reliably:

- Use a sender address from the same domain as your SMTP provider.
- Configure SPF for the sending provider.
- Configure DKIM when the provider supports it.
- Configure DMARC before wider rollout.
- Keep the subject direct and non-spammy.
- Include both plain text and HTML email bodies.
- Avoid many unrelated links in one email.
- Test Gmail, Outlook, and the real target inboxes.

If SPF/DKIM/DMARC are missing, delivery may still work, but mail can land in spam.

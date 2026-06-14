# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.4.x   | Yes       |
| 1.3.x   | Best effort |
| < 1.3   | No        |

## Reporting a vulnerability

**Please do not open public GitHub issues for security vulnerabilities.**

Instead:

1. Email or DM the maintainer: [@mafzalkalwardev](https://github.com/mafzalkalwardev)
2. Include steps to reproduce, impact, and suggested fix if any
3. Allow up to 7 days for an initial response

## Security best practices for self-hosters

- Change `JWT_SECRET` and `ENCRYPTION_KEY` in `.env` before production use
- Never commit `.env` or Gmail app passwords
- Use Docker MongoDB locally or secured Atlas with IP whitelist
- Keep Node.js, Docker, and dependencies updated
- Run behind a firewall; do not expose port 5000 to the public internet without HTTPS and auth hardening

## Sensitive data

MailForge stores:

- Hashed user passwords (bcrypt)
- Encrypted sender app passwords (AES via `ENCRYPTION_KEY`)
- Email lists and campaign data in MongoDB

Treat backups in `backups/` as confidential.

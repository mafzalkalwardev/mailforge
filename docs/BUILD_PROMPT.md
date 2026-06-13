# MailForge — Developer Reference

MailForge is the standalone product in this folder. See [README.md](../README.md) for setup.

## Stack

- Node.js 18+ / Express / MongoDB
- truemail-go (port 8082) — primary SMTP verifier
- Reacher Docker (port 8081) — optional fallback
- nodemailer + imapflow — campaigns + inbox

## Next enhancements

- OAuth2 Gmail senders
- Reply-from-inbox UI
- Campaign analytics charts
- Docker Compose all-in-one

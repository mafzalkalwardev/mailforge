# MailForge — Developer Reference

MailForge is the standalone product in this folder. See [README.md](../README.md) for setup.

## Stack

- Node.js 18+ / Express / MongoDB
- truemail-go (port 8082) — primary SMTP verifier
- Reacher Docker (port 8081) — optional fallback
- nodemailer + imapflow — campaigns + inbox

## v1.2.0 features

- Reply from unified inbox (SMTP with In-Reply-To threading)
- Campaign analytics (reply rate, replies by day/sender)
- Suppression list (manual, bounce auto-add, public unsubscribe)
- Scheduled campaigns (cron-style scheduler)
- Dashboard command center + onboarding checklist
- Sender health panel (sent today / daily limit)
- Docker full stack (`docker-compose.full.yml`)
- CI tests for SMTP response rules

## Docker

```bash
# MongoDB + MailForge app
docker compose -f docker-compose.full.yml up -d

# Optional Reacher verifier
docker compose -f docker-compose.full.yml --profile reacher up -d
```

## Screenshots

```bash
npm install --save-dev puppeteer
SCREENSHOT_EMAIL=you@example.com SCREENSHOT_PASSWORD=secret node scripts/capture-screenshots.js
```

## Next enhancements

- OAuth2 Gmail senders
- Thread view in inbox
- Team roles / multi-user org

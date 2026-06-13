# MailForge — Verification Engines

MailForge ships with two SMTP verification engines. **Use `auto` mode in production.**

## Recommended: `auto` (default)

1. **truemail-go** — primary. Performs live SMTP RCPT TO and returns the **full server response** (e.g. `550 5.1.1 User unknown`).
2. **Reacher** — fallback when truemail-go is unavailable or for forced Reacher mode.

```env
VERIFIER_ENGINE=auto
GO_VERIFIER_URL=http://localhost:8082
REACHER_URL=http://localhost:8081
```

## truemail-go (best SMTP response text)

- Built-in Go service on port **8082**
- Real SMTP dialog: connect → EHLO → MAIL FROM → RCPT TO
- Captures **550 / 250 response strings** for each address
- Fast (~10–20s per check), no Docker required
- Requires [Go 1.22+](https://go.dev/dl/)

Start manually:

```bash
npm run start:go
```

## Reacher (optional — hard providers)

- Docker container on port **8081**
- Industry-grade checks for Gmail, Outlook, Yahoo
- Slower; use when truemail gets blocked or times out

```bash
docker compose up -d
npm run start:reacher
```

## Which engine when?

| Scenario | Engine |
|----------|--------|
| Bulk B2B lists, see SMTP 550 text | **truemail-go** |
| Gmail / Microsoft addresses | **auto** or **reacher** |
| No Go installed, Docker only | **reacher** |
| Maximum accuracy + fallback | **auto** |

## Settings UI

Logged-in users can override engine, URLs, concurrency, and Reacher timeout from **Settings** in the dashboard.

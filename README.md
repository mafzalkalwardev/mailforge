<div align="center">

# MailForge

**Verify. Send. Inbox.** — one private email operations dashboard.

Self-hosted list verification with **live SMTP proof**, multi-account campaigns, and a unified reply inbox.

<br/>

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Go](https://img.shields.io/badge/Go-1.22-00ADD8?style=for-the-badge&logo=go&logoColor=white)](https://go.dev/)
[![Version](https://img.shields.io/badge/Version-1.4.2-blue?style=for-the-badge)](package.json)
[![Docker](https://img.shields.io/badge/Reacher-Optional-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)
[![Setup guide](https://img.shields.io/badge/Setup-SETUP.md-blue?style=for-the-badge)](SETUP.md)
[![Contributing](https://img.shields.io/badge/Contributing-welcome-green?style=for-the-badge)](CONTRIBUTING.md)
[![Packages](https://img.shields.io/badge/Packages-GHCR-purple?style=for-the-badge)](PACKAGES.md)

</div>

---

> **Client Windows install?** Read **[client.md](client.md)**, place the client's `indus-license*.json` file beside `Client-Install-MailForge.bat`, then double-click `Client-Install-MailForge.bat`.
>
> **Developer/new PC setup?** Follow **[SETUP.md](SETUP.md)** or run `npm run setup:new-pc` after cloning.

---

## Why MailForge?

| | Paid SaaS stack | **MailForge** |
|---|-----------------|---------------|
| Cost | Per email / seat | **$0** |
| Data | Third-party servers | **Stays on your machine** |
| SMTP proof | Sometimes | **Yes** — RCPT dialog + 550 text |
| Campaigns | Separate tool | **Built in** |
| Replies | Another inbox app | **Unified inbox** |

---

## Screenshots

### Dashboard & bulk verify
![Dashboard](docs/screenshots/dashboard.png)
![Bulk import dark mode](docs/screenshots/bulk-import-dark.png)

### Campaigns, inbox & templates
![Unified inbox](docs/screenshots/inbox.png)
![Email templates](docs/screenshots/templates.png)
![Suppression list](docs/screenshots/suppression.png)

### Dark mode
<table>
<tr>
<td width="50%"><img src="docs/screenshots/dashboard-dark.png" alt="Dashboard dark mode" /></td>
<td width="50%"><img src="docs/screenshots/senders-dark.png" alt="Senders dark mode" /></td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/login-dark.png" alt="Login dark mode" /></td>
<td width="50%"><img src="docs/screenshots/templates-modal-dark.png" alt="Template modal dark mode" /></td>
</tr>
</table>

## Features

### Verification
- **Live SMTP verification** — syntax, MX, disposable/role checks, real RCPT dialog
- **Strict SMTP validity** — 550/553/503 rejections and IP-block responses are **never** marked valid; blocked checks show as `unknown`
- **Backend bulk jobs** — upload CSV/XLSX, verification runs on the server; switch tabs freely
- **Pause / resume / stop** — control long-running verify jobs without losing progress
- **Download while running** — export completed rows or valid-only rows before a long job finishes
- **Recent job downloads** — Bulk Verify loads recent jobs immediately and can download saved or in-progress results
- **Bulk CSV / XLSX** — finds emails in any column; exports keep original columns first and append verification fields

### Campaigns & sending
- **Verify → send pipeline** — auto-redirect to campaign creator when verification completes (toggle in Settings)
- **Create from verified lists** — valid-only recipients with original CSV columns preserved
- **Multi-Gmail rotation** — delays, retries, warm-up, bulk sender import
- **Editable senders** — update email username, display name, app password, SMTP/IMAP hosts, daily limits, warm-up day, and today's send count
- **Create & start** — launch a campaign in one click from the wizard

### Templates
- **10 Freight Outreach templates** — imported from the original Auto Emailer (INDUS Transports)
- **Combined freight pack** — all 10 subjects + 10 bodies in one template for random rotation
- **Merge fields** — `{Name}`, `{Email}`, `{State}`, `{SENDER_NAME}`, `{SENDER_EMAIL}`, `{COMPANY_NAME}`
- **AI template generator** — Groq (free), OpenRouter, or OpenAI for spam-safe copy
- **Edit & manage** — full CRUD from the Templates page or inline in campaign create

### Inbox & platform
- **Unified inbox** — view all sender accounts together or filter by one Gmail account
- **Reply from inbox** — send threaded replies from the same sender account (In-Reply-To headers)
- **Unread / Starred / Important** — filter pills and toggle on each message
- **Per-account sync** — sync a single mailbox or all accounts at once
- **JWT auth**, dark mode, per-user settings

### Deliverability & compliance (v1.2)
- **Suppression list** — block bounces, unsubscribes, and manual blocks from all campaigns
- **Auto bounce suppression** — failed sends with bounce-like SMTP errors are added automatically
- **Unsubscribe links** — optional footer in every campaign email with one-click opt-out page
- **Scheduled campaigns** — set a future start time; background scheduler launches them automatically
- **Campaign analytics** — reply rate, replies over time, performance by sender account
- **Sender health dashboard** — sent today vs daily limit per Gmail account
- **Onboarding checklist** — guided setup on first login

### DevOps (v1.2)
- **Docker full stack** — `docker compose -f docker-compose.full.yml up -d` (MongoDB + app)
- **CI pipeline** — Node tests + Go build on every push
- **Screenshot script** — `node scripts/capture-screenshots.js` for README assets

### List hygiene & persistence (v1.3)
- **Mongo persistence banner** — warns when running on in-memory dev database (data lost on restart)
- **Partial verify save** — pause/stop saves progress to History as a partial bulk job
- **List hygiene score** — duplicates, age, valid ratio from History → heart icon
- **Re-verify lists** — one-click re-run verification on saved bulk jobs
- **Dedupe on campaign create** — remove duplicate emails when building a campaign
- **Export presets** — download all or valid-only CSV from History API

### Inbox CRM (v1.3)
- **Thread view** — group messages by conversation in unified inbox
- **Lead tags** — mark replies as Lead, Follow up, or Not interested (auto-suppresses)
- **Quick reply templates** — one-click reply snippets in inbox
- **Bounce detection** — IMAP sync flags bounces and adds to suppression list

### Deliverability controls (v1.3)
- **Hourly send cap** — limit sends per hour across a campaign
- **Sender auto-pause** — pause sender when failure rate exceeds threshold
- **CAN-SPAM footer** — optional physical address footer on campaign emails
- **Save partial on pause** — toggle in Settings for verify job behavior

### DevOps (v1.3)
- **Health API** — `GET /api/health` reports DB persistence and uptime
- **Backup export** — `GET /api/backup/export` downloads user data JSON
- **Bulk job utils tests** — hygiene, dedupe, export covered in CI

### Client delivery & licensing (v1.4)
- **One-click Windows installer** — `Client-Install-MailForge.bat` installs production deps, builds the Go verifier, downloads embedded MongoDB, and creates Desktop/Start Menu shortcuts
- **INDUS license gate** — subscription license verified at startup (`indus-license*.json` in app root or `./data`); local cache tolerates short offline periods after first online check
- **Portable package** — copy the full folder with `MailForge.exe`, `verifier.exe`, and `data/mongodb` to another PC (see [PORTABLE_PACKAGE_NOTES.txt](PORTABLE_PACKAGE_NOTES.txt))
- **Embedded MongoDB mode** — `MAILFORGE_DB_MODE=embedded` stores data locally without Docker or Atlas

### Performance & reliability (v1.4)
- **Faster bulk verify** — configurable concurrency via `BULK_CONCURRENCY` (default 15, max 50)
- **Hardened verifier runtime** — improved Go verifier startup, dependency pinning, and bulk worker error handling
- **Serialized progress saves** — bulk verification progress is saved safely during pause/stop

---

## Verification engine (recommended)

MailForge uses **truemail-go** as the primary engine — it performs a real SMTP RCPT dialog and captures the **server response text** (550, 250, etc.). Results are post-processed so reject codes like `550 5.7.1 Service unavailable` or `553 TSS09` are not counted as valid.

| Engine | SMTP response | Speed | Best for |
|--------|---------------|-------|----------|
| **truemail-go** (default) | Full 550/250 text | Fast | Most domains, bulk lists |
| **Reacher** (optional Docker) | Headless checks | Slower | Gmail, Outlook, hard providers |
| **auto** (recommended) | truemail first, Reacher fallback | Balanced | Production use |

Set in `.env`:

```env
VERIFIER_ENGINE=auto
```

Optional Reacher (Docker):

```bash
docker compose up -d
```

---

## Client delivery (Windows desktop app)

For a client handoff, MailForge is delivered like a local SaaS-style desktop app: the browser UI runs at `http://localhost:5000`, MongoDB data stays inside the installed app folder, and the client starts it from a Desktop or Start Menu shortcut.

Give the client:

- The full `MailForge` folder from the latest GitHub `main`.
- Their INDUS license file named `indus-license*.json`.
- The setup guide: **[client.md](client.md)**.

Client install steps:

1. Extract or copy the full `MailForge` folder to the Windows PC.
2. Put `indus-license*.json` in the MailForge folder, next to `Client-Install-MailForge.bat`.
3. Double-click `Client-Install-MailForge.bat`.
4. Let the installer finish.
5. Open MailForge from the Desktop shortcut, Start Menu, or `MailForge.exe`.
6. Use `http://localhost:5000` in the browser.

The installer prepares production Node packages, the Go SMTP verifier, embedded MongoDB binaries, local persistent data, Desktop/Start Menu shortcuts, and an uninstall entry. Docker and MongoDB Atlas are not required for the client desktop install.

The app verifies the INDUS subscription license at startup. For client deliveries, do not enable `INDUS_SKIP_LICENSE`; that flag is only for local developer QA.

---

## Quick start (developer / source checkout)

> Full developer guide: **[SETUP.md](SETUP.md)** | Client installer guide: **[client.md](client.md)** | New machine: `npm run setup:new-pc`

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Go](https://go.dev/dl/) 1.22+ (for truemail-go verifier)

### Install & run

For a client PC, use the guided Windows installer after placing the client license file beside it:

```bat
Client-Install-MailForge.bat
```

It checks Node.js, Go, and npm; offers `winget` installs for missing tools; creates `.env`; installs production dependencies; prepares embedded MongoDB; builds the Go verifier; creates shortcuts; and opens MailForge.

Manual install:

```powershell
cd MailForge
copy .env.example .env
npm run setup
npm start
```

Open **http://localhost:5000** → register → start verifying.

### Docker (production-style)

```bash
docker compose -f docker-compose.full.yml up -d
```

This starts **MongoDB** and the **MailForge app** on port 5000. Run truemail-go on the host at `:8082`, or add the Reacher profile:

```bash
docker compose -f docker-compose.full.yml --profile reacher up -d
```

### Persistent data on Windows (recommended — no Atlas IP whitelist)

Atlas blocks connections unless your IP is whitelisted. For local dev, use **Docker MongoDB** on your PC — data survives restarts and Compass works at `mongodb://127.0.0.1:27017/mailforge`.

**Easiest start (pick one):**

| Method | How |
|--------|-----|
| **MailForge.exe** | Double-click `MailForge.exe` in the project folder (build with `npm run build:exe`) |
| **Batch file** | Double-click `Start-MailForge.bat` |
| **npm** | `npm run start:easy` |

```powershell
npm run mongo:up          # MongoDB only (if app already running)
npm start                 # app only
npm run build:exe         # rebuild MailForge.exe launcher
```

MongoDB Compass: connect with **`mongodb://127.0.0.1:27017`** → database **`mailforge`**.

Optional Atlas cloud backup: uncomment `MONGO_URI` in `.env` only when Network Access allows your IP.

One-command start (Node + Go verifier on Windows):

```powershell
npm run start:all
```

### Optional: AI templates

**Groq (free tier, recommended)** — get a key at [console.groq.com](https://console.groq.com):

```env
AI_PROVIDER=groq
GROQ_API_KEY=gsk_your_key_here
```

Also supports **OpenRouter** (free models) and **OpenAI**. Configure in **Settings → AI & workflow** or via `.env`.

---

## Workflow

```mermaid
flowchart LR
    A[Upload CSV/XLSX] --> B[Bulk Verify]
    B --> C[Valid-only list]
    C --> D[Create Campaign]
    D --> E[Multi-sender SMTP]
    E --> F[Unified Inbox]
    F --> G[Read replies]
```

1. **Bulk Verify** — upload your list; pause/resume as needed
2. **Auto-redirect** — when done, opens Create Campaign with the verified list loaded
3. **Templates** — pick a starter template or generate spam-safe copy with AI
4. **Senders** — add Gmail accounts (App Passwords), bulk import, or edit account details and warm-up limits later
5. **Create & Start** — launch the campaign
6. **Inbox** — sync and read replies

You can also go **History → plane icon → Create Campaign** at any time.

---

## API highlights

| Endpoint | Description |
|----------|-------------|
| `POST /api/verify/jobs` | Start backend bulk verify (CSV/XLSX upload) |
| `POST /api/verify/jobs/:id/pause` | Pause a running job |
| `POST /api/verify/jobs/:id/resume` | Resume a paused job |
| `POST /api/verify/jobs/:id/cancel` | Stop a job |
| `GET /api/verify/jobs/recent` | List recent backend verification jobs |
| `GET /api/verify/jobs/:id?full=1` | Get completed and pending rows for full or partial download |
| `POST /api/campaigns/from-bulk-job` | Create campaign from verified list |
| `GET /api/senders` | List sender accounts with warm-up status |
| `PUT /api/senders/:id` | Edit sender email, password, SMTP/IMAP settings, enabled flags, daily limit, warm-up day, and sent-today count |
| `POST /api/inbox/:id/reply` | Send threaded reply from inbox |
| `GET /api/campaigns/:id/analytics` | Campaign reply rate & charts |
| `GET /api/dashboard/overview` | Command center stats + onboarding |
| `GET /api/suppression` | Suppression list CRUD |
| `POST /api/suppression/unsubscribe` | Public one-click unsubscribe |
| `GET /api/history/bulk-jobs/:id/hygiene` | List hygiene score & stats |
| `GET /api/history/bulk-jobs/:id/export` | Export bulk job CSV (filter=valid) |
| `POST /api/history/bulk-jobs/:id/reverify` | Re-verify a saved list |
| `GET /api/health` | App health + Mongo persistence status |
| `GET /api/backup/export` | Download user data backup JSON |
| `POST /api/inbox/:id/lead-tag` | Tag inbox reply (lead / follow up / not interested) |

---

## Tech stack

```
Browser → Node.js + Express (:5000)
              ├── MongoDB (or in-memory dev)
              ├── truemail-go (:8082) — SMTP verification
              ├── Reacher Docker (:8081) — optional fallback
              ├── nodemailer — campaign sending
              ├── imapflow — inbox sync
              └── OpenAI API — optional AI templates
```

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | Web UI port |
| `JWT_SECRET` | — | Auth signing key |
| `MAILFORGE_DB_MODE` | `embedded` | `embedded` (local portable MongoDB) or `external` (use `MONGO_URI`) |
| `MAILFORGE_DATA_DIR` | `./data` | Root folder for MongoDB data and license files |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/mailforge` | Used when `MAILFORGE_DB_MODE=external`. For dev, run `npm run mongo:up` or use Atlas if IP is whitelisted |
| `VERIFIER_ENGINE` | `auto` | `auto`, `truemail`, or `reacher` |
| `GO_VERIFIER_URL` | `http://localhost:8082` | truemail-go API |
| `BULK_CONCURRENCY` | `15` | Parallel SMTP checks during bulk verify (1–50) |
| `ENCRYPTION_KEY` | — | Encrypts sender credentials |
| `OPENAI_API_KEY` | — | Optional — OpenAI template generation |
| `GROQ_API_KEY` | — | Optional — Groq free tier (recommended) |
| `AI_PROVIDER` | `groq` | `groq`, `openrouter`, or `openai` |
| `APP_BASE_URL` | `http://localhost:5000` | Public URL for unsubscribe links |
| `INDUS_SKIP_LICENSE` | unset | Developer QA bypass only; do not enable in client deliveries |

See [`.env.example`](.env.example) for all options.

Per-user overrides (verifier URLs, OpenAI key, auto-redirect after verify) are available in **Settings**.

---

## GitHub repository

**https://github.com/mafzalkalwardev/mailforge**

| Resource | Link |
|----------|------|
| **Clone** | `git clone https://github.com/mafzalkalwardev/mailforge.git` |
| **New PC setup** | [SETUP.md](SETUP.md) |
| **Client install guide** | [client.md](client.md) |
| **Portable package** | [PORTABLE_PACKAGE_NOTES.txt](PORTABLE_PACKAGE_NOTES.txt) |
| **Contributing** | [CONTRIBUTING.md](CONTRIBUTING.md) |
| **Security** | [SECURITY.md](SECURITY.md) |
| **Report bugs** | [Issues](https://github.com/mafzalkalwardev/mailforge/issues) |
| **Pull requests** | [Contributing guide](CONTRIBUTING.md) |

| Field | Value |
|-------|-------|
| **Repository name** | `mailforge` |
| **Description** | Self-hosted email operations platform — verify lists with live SMTP proof, run multi-sender campaigns, and manage every reply from one unified inbox. Free, private, no SaaS APIs. |
| **Topics** | `email-verification`, `smtp`, `email-marketing`, `self-hosted`, `nodejs`, `campaigns`, `inbox`, `mongodb`, `docker`, `open-source` |

---

## Contributing

We welcome contributions! See **[CONTRIBUTING.md](CONTRIBUTING.md)** for:

- Fork and PR workflow
- Development setup
- Issue and PR templates
- Code guidelines

Good first contributions: docs, tests, bug fixes, UI polish.

---

## License

MIT — see [LICENSE](LICENSE).

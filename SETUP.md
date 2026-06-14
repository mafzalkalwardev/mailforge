# New PC setup guide

Complete checklist to install MailForge on a **fresh Windows machine**.

---

## 1. Install prerequisites

| Software | Version | Download | Required |
|----------|---------|----------|----------|
| **Node.js** | 18+ LTS | [nodejs.org](https://nodejs.org/) | Yes |
| **Docker Desktop** | Latest | [docker.com](https://www.docker.com/products/docker-desktop/) | Yes (persistent data) |
| **Go** | 1.22+ | [go.dev/dl](https://go.dev/dl/) | Yes (SMTP verifier) |
| **Git** | Latest | [git-scm.com](https://git-scm.com/) | Yes (clone repo) |

Optional: [MongoDB Compass](https://www.mongodb.com/products/compass) to browse data at `mongodb://127.0.0.1:27017/mailforge`.

---

## 2. Clone the repository

```powershell
git clone https://github.com/mafzalkalwardev/mailforge.git
cd mailforge
```

---

## 3. One-command setup (Windows)

```powershell
npm run setup:new-pc
```

This script will:

1. Check Node.js, Docker, and Go
2. Run `npm install` and `go mod tidy`
3. Copy `.env.example` → `.env` if missing
4. Pull and start MongoDB via Docker
5. Build `MailForge.exe` launcher (optional, needs .NET Framework)

---

## 4. Manual setup (if you prefer step-by-step)

```powershell
# 1. Environment
copy .env.example .env
# Edit .env: set JWT_SECRET and ENCRYPTION_KEY to long random strings

# 2. Dependencies
npm run setup

# 3. Start Docker Desktop, then MongoDB
npm run mongo:up

# 4. Build desktop launcher (optional)
npm run build:exe

# 5. Start app
npm run start:easy
```

Open **http://localhost:5000** → **Register** → log in.

---

## 5. Configure `.env` (important)

Edit `.env` before first production use:

```env
JWT_SECRET=replace_with_64_char_random_string
ENCRYPTION_KEY=replace_with_32_char_random_string
MONGO_URI=mongodb://127.0.0.1:27017/mailforge
```

Generate secrets in PowerShell:

```powershell
-join ((48..57 + 65..90 + 97..122) | Get-Random -Count 48 | ForEach-Object {[char]$_})
```

---

## 6. Add Gmail senders

1. Go to [Google App Passwords](https://myaccount.google.com/apppasswords)
2. Create an app password for Mail
3. In MailForge → **Senders** → Add account (email + app password)
4. Or bulk import CSV: `Email`, `AppPassword`, `Name`

---

## 7. Verify persistence works

1. Start app with Docker running
2. Go to **Settings → Connection** — should show **Persistent storage** (green)
3. Register, add a sender, restart app — data should remain

If you see the yellow in-memory banner, run:

```powershell
npm run mongo:up
```

Then restart the app.

---

## 8. Daily use

| Action | Command |
|--------|---------|
| Start everything | Double-click `Start-MailForge.bat` or `MailForge.exe` |
| Start (npm) | `npm run start:easy` |
| MongoDB only | `npm run mongo:up` |
| App only | `npm start` |
| Backup database | `npm run mongo:backup` |
| Download JSON backup | Settings → Download my data |
| Run tests | `npm test` |

---

## 9. Troubleshooting

| Problem | Fix |
|---------|-----|
| Docker not running | Open Docker Desktop, wait for "Running", retry |
| MongoDB connection failed | `npm run mongo:up`, check port 27017 is free |
| Server crashes on inbox sync | Update to latest; bad Gmail accounts are skipped |
| Atlas IP blocked | Use local Docker Mongo (`MONGO_URI` in `.env`) |
| truemail-go not starting | Install Go 1.22+, run `npm run setup:go` |
| Port 5000 in use | Set `PORT=5001` in `.env` |

---

## 10. Moving to another PC

1. On old PC: **Settings → Download my data** + `npm run mongo:backup`
2. Copy `backups/` folder and `.env` (keep secrets private)
3. On new PC: follow this guide, restore Mongo backup if needed:

```powershell
docker cp .\backups\mailforge-YYYYMMDD\ mailforge-mongo:/tmp/restore
docker exec mailforge-mongo mongorestore --db=mailforge --drop /tmp/restore
```

---

## Links

- [README](README.md) — features and API
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to contribute
- [GitHub Issues](https://github.com/mafzalkalwardev/mailforge/issues)

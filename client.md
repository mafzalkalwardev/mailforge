# MailForge Client Installation

Use this guide to install and run MailForge on a client's Windows PC.

## Requirements

- Windows 10 or Windows 11
- Node.js 18 LTS or newer
- Docker Desktop for persistent local MongoDB
- Internet access for first-time package installation

## Install

1. Copy the full `MailForge` folder to the client PC.
2. Install Node.js from `https://nodejs.org`.
3. Install Docker Desktop from `https://www.docker.com/products/docker-desktop/`.
4. Start Docker Desktop and wait until it says Docker is running.
5. Double-click `Install-And-Run-MailForge.bat`.

The BAT file will:

- Create `.env` from `.env.example` if needed.
- Run `npm install` the first time.
- Start local MongoDB with Docker.
- Open `http://localhost:5000`.
- Start the MailForge server.

## Login And Setup

1. Open `http://localhost:5000`.
2. Create the first user account.
3. Go to `Senders` and add SMTP/IMAP sender accounts.
4. Go to `Settings` and confirm verification and sending settings.
5. Use `Bulk Verify`, then create a campaign from valid emails.

## Running Later

After the first install, start Docker Desktop and double-click:

`Install-And-Run-MailForge.bat`

You can also use the existing quick launcher:

`Start-MailForge.bat`

## Important Client Notes

- Keep the command window open while MailForge is running.
- The local app URL is `http://localhost:5000`.
- Sender passwords are stored encrypted with the `ENCRYPTION_KEY` in `.env`.
- Do not delete `.env`, `uploads`, or the Docker volume if the client needs saved data.
- If changing PCs, copy the full folder and back up MongoDB first.

## Common Fixes

- If the app says MongoDB is not available, start Docker Desktop and run the BAT again.
- If port `5000` is already used, change `PORT=5000` in `.env`.
- If email sending fails, check each sender's SMTP host, port, email, password/app password, and enabled status.
- For Gmail, use an app password when two-step verification is enabled.

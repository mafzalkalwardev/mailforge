# MailForge Client Setup

Give this file to the client with the MailForge folder. It is the step-by-step setup guide they can read and follow without needing developer tools.

MailForge installs like a local desktop SaaS app:

- The web app opens in the browser at `http://localhost:5000`.
- The database runs locally with embedded MongoDB.
- Client data stays on the client's PC.
- The app starts from the Desktop shortcut, Start Menu, or `MailForge.exe`.

## What You Should Receive

- A folder named `MailForge`.
- A license file named like `indus-license-client-name.json`.
- This setup file, `client.md`.

Keep the license file private. It is required for startup.

## Requirements

- Windows 10 or Windows 11
- Internet access for first-time setup
- The installer can install Node.js LTS and Go with `winget` if they are missing
- Docker is not required
- A valid INDUS subscription license file from the INDUS dashboard

## Install

1. Copy the full `MailForge` folder to the client PC.
2. Copy the client's `indus-license*.json` file into the same `MailForge` folder.
   - The app also accepts the license file in `MailForge\data\`.
   - Keep the filename starting with `indus-license` and ending with `.json`.
3. Double-click `Client-Install-MailForge.bat`.
4. Let the installer finish.
5. Start MailForge from the Start Menu, Desktop shortcut, or `MailForge.exe`.

Recommended folder before install:

```text
MailForge\
  Client-Install-MailForge.bat
  client.md
  indus-license-client-name.json
  package.json
  scripts\
  backend\
  public\
  ...
```

The installer will:

- Install production Node packages.
- Build the local Go verifier executable.
- Download the embedded MongoDB binary into `tools/mongodb-binaries`.
- Store all app data in `data/mongodb` inside the installed app folder.
- Create a Desktop shortcut.
- Create a Start Menu shortcut.
- Register MailForge in Windows Apps & Features / Control Panel uninstall list.

## Running Later

Open MailForge from:

- Start Menu > MailForge
- Desktop shortcut
- `%LOCALAPPDATA%\Programs\MailForge\MailForge.exe`

The app opens at:

`http://localhost:5000`

On startup, MailForge verifies the INDUS license online. After a successful online check, the app can tolerate short internet outages using its local license cache. If the client sees `No INDUS license file found`, place the license JSON in the app folder or `data` folder and start MailForge again.

## First Login

1. Open `http://localhost:5000`.
2. Register the first admin user.
3. Go to Settings and confirm the verifier status is ready.
4. Add sender accounts in Senders.
5. Use Gmail app passwords, not normal Gmail passwords.
6. Upload a small test list in Bulk Verify before running a large campaign.

## Data

MailForge stores client data locally in:

`%LOCALAPPDATA%\Programs\MailForge\data\mongodb`

Do not delete the `data` folder unless you intentionally want to remove saved users, senders, verified lists, inbox data, and campaigns.

## Updating MailForge Later

1. Close MailForge.
2. Keep a copy of the installed `data` folder and `.env`.
3. Replace the app files with the newer MailForge package.
4. Keep the same `indus-license*.json` file in the app folder or `data` folder.
5. Run `Client-Install-MailForge.bat` again.

The installer is safe to rerun for repairs or updates.

## Uninstall

Use Windows Settings > Apps > Installed Apps > MailForge > Uninstall.

To remove the app but keep local data, run:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Programs\MailForge\scripts\uninstall-windows.ps1" -KeepData
```

## Common Fixes

- If port `5000` is already used, change `PORT=5000` in `.env`.
- If startup says `No INDUS license file found`, copy the client's `indus-license*.json` file into the MailForge folder or `data` folder.
- If startup says the subscription expired, renew or download a fresh license from the INDUS dashboard.
- If verification cannot start, run `Client-Install-MailForge.bat` again to rebuild the verifier and prepare MongoDB.
- If email sending fails, check each sender's SMTP host, port, email, password/app password, and enabled status.
- For Gmail, use an app password when two-step verification is enabled.

# Contributing to MailForge

Thank you for helping improve MailForge! This project welcomes bug fixes, docs, tests, and features.

## Quick links

- [Setup guide](SETUP.md) — install on a new PC
- [Report a bug](https://github.com/mafzalkalwardev/mailforge/issues/new?template=bug_report.md)
- [Request a feature](https://github.com/mafzalkalwardev/mailforge/issues/new?template=feature_request.md)

## How to contribute

1. **Fork** the repo on GitHub
2. **Clone** your fork locally
3. Create a branch: `git checkout -b fix/my-change`
4. Make changes and run tests: `npm test`
5. Commit with a clear message (what and why)
6. Push and open a **Pull Request** against `main`

## Development setup

Windows (checks Node, Docker, and Go, then starts MongoDB):

```powershell
git clone https://github.com/YOUR_USERNAME/mailforge.git
cd mailforge
npm run setup:new-pc
npm run dev
```

Linux or macOS:

```bash
git clone https://github.com/YOUR_USERNAME/mailforge.git
cd mailforge
cp .env.example .env
```

Set `JWT_SECRET` and `ENCRYPTION_KEY` in `.env` to long random strings, then:

```bash
npm install
INDUS_SKIP_LICENSE=1 npm start
```

`INDUS_SKIP_LICENSE=1` is for local development. Client deliveries use an `indus-license*.json` file instead.

App plus MongoDB in Docker:

```bash
docker compose -f docker-compose.full.yml up -d --build
```

`docker compose up -d` (no `-f`) starts only the optional Reacher verifier.

Issue forms: [bug report](https://github.com/mafzalkalwardev/mailforge/issues/new?template=bug_report.md) and [feature request](https://github.com/mafzalkalwardev/mailforge/issues/new?template=feature_request.md).

## Code guidelines

- Match existing style and naming in the file you edit
- Keep PRs focused — one feature or fix per PR
- Add tests when fixing bugs in `utils/` or verification logic
- Do not commit `.env`, secrets, or `node_modules/`
- Use ASCII in PowerShell scripts (no smart quotes or em dashes)

## Areas we welcome help

- Gmail OAuth (replace App Passwords)
- Multi-user teams and roles
- UI/UX and accessibility
- Documentation and setup scripts
- Test coverage
- Docker / CI improvements

## Commit messages

Use present tense, concise summaries:

- `fix: prevent IMAP timeout from crashing server`
- `docs: add new PC setup guide`
- `feat: add campaign retry queue endpoint`

## Questions

Open a [Discussion](https://github.com/mafzalkalwardev/mailforge/discussions) or an Issue if you are unsure before large changes.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

# GitHub Packages

MailForge publishes to **GitHub Packages** so you can pull releases without cloning the repo.

## Docker image (GHCR)

After each release tag, a container image is published to:

```
ghcr.io/mafzalkalwardev/mailforge:latest
ghcr.io/mafzalkalwardev/mailforge:1.4.1
```

### Pull and run

```bash
docker pull ghcr.io/mafzalkalwardev/mailforge:latest
docker run -p 5000:5000 \
  -e JWT_SECRET=your_secret \
  -e ENCRYPTION_KEY=your_key \
  -e MONGO_URI=mongodb://host.docker.internal:27017/mailforge \
  ghcr.io/mafzalkalwardev/mailforge:latest
```

Start MongoDB first: `npm run mongo:up` or use `docker-compose.full.yml`.

### Make package public (one-time)

1. Go to https://github.com/users/mafzalkalwardev/packages
2. Open **mailforge** container package
3. **Package settings** → Change visibility to **Public** (optional)

## npm package (optional)

Scoped package for tooling/CI:

```
@mafzalkalwardev/mailforge
```

Published on release to `https://npm.pkg.github.com`.

### Install from GitHub Packages

Create `.npmrc`:

```
@mafzalkalwardev:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
```

```bash
npm install @mafzalkalwardev/mailforge
```

## Enable packages on your other repos

1. Add `.github/workflows/publish-docker.yml` (copy from this repo)
2. Ensure `packages: write` permission in workflow
3. Tag a release: `git tag v1.0.0 && git push origin v1.0.0`
4. Image appears under **Packages** on your GitHub profile

## Manual publish (maintainers)

```bash
# Docker (local build)
docker build -t ghcr.io/mafzalkalwardev/mailforge:local .
docker push ghcr.io/mafzalkalwardev/mailforge:local

# npm (requires GITHUB_TOKEN with write:packages)
npm publish
```

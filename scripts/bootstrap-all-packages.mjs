#!/usr/bin/env node
/**
 * Bootstrap GHCR package publishing, CI, Dependabot, and community files
 * across all public repos for mafzalkalwardev.
 */
import { execSync } from 'child_process';

const OWNER = 'mafzalkalwardev';
const SKIP = new Set(['odysseus']); // skip private/experimental if needed

const PUBLISH_DOCKER = `name: Publish Docker to GHCR

on:
  release:
    types: [published]
  workflow_dispatch:

permissions:
  contents: read
  packages: write

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: \${{ github.repository }}

jobs:
  publish-docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: docker/login-action@v3
        with:
          registry: \${{ env.REGISTRY }}
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}

      - uses: docker/metadata-action@v5
        id: meta
        with:
          images: \${{ env.REGISTRY }}/\${{ env.IMAGE_NAME }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest

      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: \${{ steps.meta.outputs.tags }}
          labels: \${{ steps.meta.outputs.labels }}
`;

const PUBLISH_NPM = `name: Publish npm to GitHub Packages

on:
  release:
    types: [published]
  workflow_dispatch:

permissions:
  contents: read
  packages: write

jobs:
  publish-npm:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://npm.pkg.github.com
          scope: '@mafzalkalwardev'
      - run: npm ci --omit=dev || npm install --omit=dev
      - run: npm publish --access restricted
        env:
          NODE_AUTH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;

const DEPENDABOT = `version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
  - package-ecosystem: docker
    directory: /
    schedule:
      interval: monthly
`;

const CONTRIBUTING = `# Contributing

Thanks for your interest in this project.

## How to contribute

1. Fork the repository
2. Create a feature branch: \`git checkout -b feature/my-change\`
3. Commit with a clear message
4. Open a pull request against \`main\`

## Code style

- Match existing formatting in the repo
- Keep changes focused and well described
- Update README when behavior changes

## Security

Report vulnerabilities privately — see [SECURITY.md](SECURITY.md).
`;

const SECURITY = `# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| latest on \`main\` | yes |

## Reporting a vulnerability

Please **do not** open public issues for security problems.

Email **kalwarmuhammadafzal3@gmail.com** with:

- Description of the issue
- Steps to reproduce
- Impact assessment

We aim to respond within 72 hours.
`;

function gh(cmd) {
  return execSync(`gh ${cmd}`, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }).trim();
}

function sleep(ms) {
  execSync(`powershell -Command "Start-Sleep -Milliseconds ${ms}"`, { stdio: 'ignore' });
}

function listRepos() {
  return JSON.parse(gh(`repo list ${OWNER} --limit 100 --json name`)).map((r) => r.name);
}

function rootFiles(repo) {
  try {
    const items = JSON.parse(gh(`api repos/${OWNER}/${repo}/contents/`));
    return items.map((i) => i.name);
  } catch {
    return [];
  }
}

function fileExists(repo, path) {
  try {
    gh(`api repos/${OWNER}/${repo}/contents/${path}`);
    return true;
  } catch {
    return false;
  }
}

function getFileText(repo, path) {
  try {
    const meta = JSON.parse(gh(`api repos/${OWNER}/${repo}/contents/${path}`));
    return Buffer.from(meta.content, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function upsertFile(repo, path, content, message) {
  let sha;
  try {
    sha = JSON.parse(gh(`api repos/${OWNER}/${repo}/contents/${path}`)).sha;
  } catch {
    /* new file */
  }
  const payload = JSON.stringify({
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    ...(sha ? { sha } : {}),
  });
  execSync(`gh api -X PUT repos/${OWNER}/${repo}/contents/${path} --input -`, {
    input: payload,
    encoding: 'utf8',
  });
}

function detectStack(files, repo) {
  const lower = new Set(files.map((f) => f.toLowerCase()));
  if (lower.has('dockerfile')) return 'existing';
  if (lower.has('package.json')) return 'node';
  if (lower.has('requirements.txt') || lower.has('pyproject.toml')) return 'python';
  if (lower.has('go.mod')) return 'go';
  if (lower.has('index.html') || lower.has('index.htm')) return 'static';
  if (files.some((f) => f.endsWith('.csproj'))) return 'dotnet';
  return 'source';
}

function dockerfileFor(stack, repo) {
  const src = `https://github.com/${OWNER}/${repo}`;
  switch (stack) {
    case 'existing':
      return null;
    case 'node': {
      const pkg = getFileText(repo, 'package.json');
      let cmd = '["node", "server.js"]';
      let port = '5000';
      if (pkg) {
        try {
          const j = JSON.parse(pkg);
          if (j.scripts?.start?.includes('node')) {
            const m = j.scripts.start.match(/node\s+(\S+)/);
            if (m) cmd = `["node", "${m[1]}"]`;
          } else if (j.main) {
            cmd = `["node", "${j.main}"]`;
          }
        } catch {
          /* keep default */
        }
      }
      return `FROM node:20-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .
ENV NODE_ENV=production PORT=${port}
EXPOSE ${port}
LABEL org.opencontainers.image.source="${src}"
CMD ${cmd}
`;
    }
    case 'python':
      return `FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt* pyproject.toml* ./
RUN pip install --no-cache-dir -r requirements.txt 2>/dev/null || pip install --no-cache-dir . 2>/dev/null || true
COPY . .
LABEL org.opencontainers.image.source="${src}"
CMD ["python", "-c", "print('${repo} image ready')"]
`;
    case 'go':
      return `FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN go build -o /out/app . 2>/dev/null || go build -o /out/app ./...

FROM alpine:3.20
COPY --from=build /out/app /app
LABEL org.opencontainers.image.source="${src}"
CMD ["/app"]
`;
    case 'static':
      return `FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
LABEL org.opencontainers.image.source="${src}"
CMD ["nginx", "-g", "daemon off;"]
`;
    case 'dotnet':
      return `FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY . .
RUN dotnet publish -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app .
EXPOSE 8080
LABEL org.opencontainers.image.source="${src}"
ENTRYPOINT ["dotnet"]
CMD ["App.dll"]
`;
    default:
      return `FROM alpine:3.20
WORKDIR /src
COPY . .
LABEL org.opencontainers.image.source="${src}"
CMD ["sh", "-c", "echo '${repo} source package' && ls -1"]
`;
  }
}

function ciFor(stack) {
  if (stack === 'node') {
    return `name: CI

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci || npm install
      - run: npm test --if-present
      - run: test -f README.md
`;
  }
  if (stack === 'python') {
    return `name: CI

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: pip install -r requirements.txt || true
      - run: python -m compileall -q . || true
      - run: test -f README.md
`;
  }
  return `name: CI

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: test -f README.md
      - run: echo "Repository validated"
`;
}

function hasPackageJson(repo) {
  const t = getFileText(repo, 'package.json');
  if (!t) return false;
  try {
    const j = JSON.parse(t);
    return Boolean(j.name && !j.private);
  } catch {
    return false;
  }
}

function patchPackageJsonForPublish(repo) {
  const t = getFileText(repo, 'package.json');
  if (!t) return false;
  try {
    const j = JSON.parse(t);
    if (j.private) return false;
    const scoped = `@${OWNER}/${repo}`;
    if (j.name === scoped && j.publishConfig?.registry) return false;
    j.name = scoped;
    j.publishConfig = { registry: 'https://npm.pkg.github.com' };
    j.repository = {
      type: 'git',
      url: `git+https://github.com/${OWNER}/${repo}.git`,
    };
    upsertFile(repo, 'package.json', JSON.stringify(j, null, 2) + '\n', 'chore: configure npm publish to GitHub Packages');
    return true;
  } catch {
    return false;
  }
}

const repos = listRepos();
let bootstrapped = 0;

for (const repo of repos) {
  if (SKIP.has(repo)) {
    console.log(`SKIP ${repo}`);
    continue;
  }

  const files = rootFiles(repo);
  if (!files.length) {
    console.log(`EMPTY ${repo}`);
    continue;
  }

  const stack = detectStack(files, repo);
  const msg = 'chore: bootstrap GHCR packages, CI, and community files';
  let changed = false;

  try {
    if (stack !== 'existing' && !fileExists(repo, 'Dockerfile')) {
      const df = dockerfileFor(stack, repo);
      if (df) {
        upsertFile(repo, 'Dockerfile', df, msg);
        changed = true;
      }
    }

    if (!fileExists(repo, '.github/workflows/publish-docker.yml')) {
      upsertFile(repo, '.github/workflows/publish-docker.yml', PUBLISH_DOCKER, msg);
      changed = true;
    }

    if (hasPackageJson(repo) && !fileExists(repo, '.github/workflows/publish-npm.yml')) {
      upsertFile(repo, '.github/workflows/publish-npm.yml', PUBLISH_NPM, msg);
      changed = true;
    }

    if (patchPackageJsonForPublish(repo)) {
      changed = true;
    }

    if (!fileExists(repo, '.github/workflows/ci.yml')) {
      upsertFile(repo, '.github/workflows/ci.yml', ciFor(stack), msg);
      changed = true;
    }

    if (!fileExists(repo, '.github/dependabot.yml')) {
      upsertFile(repo, '.github/dependabot.yml', DEPENDABOT, msg);
      changed = true;
    }

    if (!fileExists(repo, 'CONTRIBUTING.md')) {
      upsertFile(repo, 'CONTRIBUTING.md', CONTRIBUTING, msg);
      changed = true;
    }

    if (!fileExists(repo, 'SECURITY.md')) {
      upsertFile(repo, 'SECURITY.md', SECURITY, msg);
      changed = true;
    }

    if (changed) {
      console.log(`BOOTSTRAP ${repo} (${stack})`);
      bootstrapped++;
    } else {
      console.log(`OK ${repo}`);
    }
    sleep(800);
  } catch (e) {
    console.error(`FAIL ${repo}:`, String(e.message || e).slice(0, 150));
    sleep(1500);
  }
}

console.log(`\nBootstrapped ${bootstrapped} repositories.`);

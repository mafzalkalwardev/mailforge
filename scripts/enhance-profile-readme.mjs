#!/usr/bin/env node
/** Add GitHub Packages section + achievement badges to profile README repo. */
import { execSync } from 'child_process';

const OWNER = 'mafzalkalwardev';
const PROFILE = 'mafzalkalwardev';

function gh(cmd) {
  return execSync(`gh ${cmd}`, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }).trim();
}

function upsertFile(repo, path, content, message) {
  const sha = JSON.parse(gh(`api repos/${OWNER}/${repo}/contents/${path}`)).sha;
  const payload = JSON.stringify({
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    sha,
  });
  execSync(`gh api -X PUT repos/${OWNER}/${repo}/contents/${path} --input -`, {
    input: payload,
    encoding: 'utf8',
  });
}

const repos = JSON.parse(gh(`repo list ${OWNER} --limit 100 --json name,description`))
  .filter((r) => r.name !== PROFILE && r.name !== `${OWNER}.github.io`);

const packageRows = repos
  .map((r) => `| [${r.name}](https://github.com/${OWNER}/${r.name}) | \`ghcr.io/${OWNER}/${r.name}:latest\` |`)
  .join('\n');

const SNAKE_WORKFLOW = `name: Profile Contribution Snake

on:
  schedule:
    - cron: "0 4 * * *"
  workflow_dispatch:

permissions:
  contents: write

jobs:
  snake:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Platane/snk@v3
        with:
          github_user_name: ${OWNER}
          outputs: dist/github-contribution-grid-snake.svg
      - uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: \${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
          destination_dir: .
          keep_files: true
`;

const readme = JSON.parse(gh(`api repos/${OWNER}/${PROFILE}/readme`));
let text = Buffer.from(readme.content, 'base64').toString('utf8');

const packagesBlock = `## GitHub Packages

Docker images for all projects are published to **GitHub Container Registry (GHCR)** on release.

![GitHub packages](https://img.shields.io/badge/GitHub-Packages-24292f?style=for-the-badge&logo=github&logoColor=white)
![GHCR](https://img.shields.io/badge/GHCR-Container_Registry-2496ED?style=for-the-badge&logo=docker&logoColor=white)

| Repository | Pull |
|------------|------|
${packageRows}

\`\`\`bash
docker pull ghcr.io/${OWNER}/mailforge:latest
\`\`\`

`;

const trophiesBlock = `## GitHub Trophies

![trophy](https://github-profile-trophy.vercel.app/?username=${OWNER}&theme=darkhub&no-frame=true&column=4&margin-w=15&margin-h=15)

## Stats

![GitHub Streak](https://github-readme-streak-stats.herokuapp.com/?user=${OWNER}&theme=tokyonight&hide_border=true)
![Top Langs](https://github-readme-stats.vercel.app/api/top-langs/?username=${OWNER}&layout=compact&theme=tokyonight&hide_border=true)
![GitHub Stats](https://github-readme-stats.vercel.app/api?username=${OWNER}&show_icons=true&theme=tokyonight&hide_border=true&include_all_commits=true&count_private=true)

![Contribution snake](https://${OWNER}.github.io/github-contribution-grid-snake.svg)

`;

if (!text.includes('## GitHub Packages')) {
  const anchor = text.includes('## Featured Projects')
    ? '## Featured Projects'
    : text.includes('## Projects')
      ? '## Projects'
      : '---';
  text = text.includes('## Featured Projects') || text.includes('## Projects')
    ? text.replace(anchor, packagesBlock + '\n' + anchor)
    : text.trimEnd() + '\n\n---\n\n' + packagesBlock;
}

if (!text.includes('github-profile-trophy')) {
  text = text.trimEnd() + '\n\n---\n\n' + trophiesBlock;
}

upsertFile(PROFILE, 'README.md', text, 'docs: add GitHub Packages, trophies, and stats to profile');

try {
  gh(`api repos/${OWNER}/${PROFILE}/contents/.github/workflows/profile-snake.yml`);
  console.log('Snake workflow already exists');
} catch {
  const payload = JSON.stringify({
    message: 'chore: add contribution snake workflow for profile',
    content: Buffer.from(SNAKE_WORKFLOW, 'utf8').toString('base64'),
  });
  execSync(`gh api -X PUT repos/${OWNER}/${PROFILE}/contents/.github/workflows/profile-snake.yml --input -`, {
    input: payload,
    encoding: 'utf8',
  });
  console.log('Added profile snake workflow');
}

console.log('Profile README updated.');

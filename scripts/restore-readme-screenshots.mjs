#!/usr/bin/env node
/** Restore app.png screenshot block when the file exists but README has no screenshot images. */
import { execSync } from 'child_process';

const OWNER = 'mafzalkalwardev';

function gh(cmd) {
  return execSync(`gh ${cmd}`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();
}

function listRepos() {
  return JSON.parse(gh(`repo list ${OWNER} --limit 100 --json name`)).map((r) => r.name);
}

function getScreenshotFiles(repo) {
  try {
    return JSON.parse(gh(`api repos/${OWNER}/${repo}/contents/docs/screenshots`)).map((i) => i.name);
  } catch {
    return [];
  }
}

function hasScreenshotImage(text) {
  return /!\[[^\]]*\]\(docs\/screenshots\/[^)]+\)|src="docs\/screenshots\/[^"]+"/i.test(text);
}

function insertScreenshotBlock(text) {
  const block = '## Screenshots\n\n![Application screenshot](docs/screenshots/app.png)\n\n';
  if (/^## Features/im.test(text)) {
    return text.replace(/^## Features/im, block + '## Features');
  }
  if (/^## Why /im.test(text)) {
    return text.replace(/^(---\n\n)(?=## Why )/m, `$1${block}`);
  }
  const idx = text.indexOf('\n---\n');
  if (idx !== -1) {
    return text.slice(0, idx + 5) + '\n' + block + text.slice(idx + 5);
  }
  return text.trimEnd() + '\n\n' + block;
}

function updateReadme(repo, content, sha) {
  const payload = JSON.stringify({
    message: 'docs: restore app.png screenshot in README',
    content: Buffer.from(content, 'utf8').toString('base64'),
    sha,
  });
  execSync(`gh api -X PUT repos/${OWNER}/${repo}/contents/README.md --input -`, {
    input: payload,
    encoding: 'utf8',
  });
}

let restored = 0;
for (const repo of listRepos()) {
  if (repo === 'mafzalkalwardev' || repo === 'mafzalkalwardev.github.io') continue;

  const files = getScreenshotFiles(repo);
  if (!files.includes('app.png')) continue;

  let readme;
  try {
    readme = JSON.parse(gh(`api repos/${OWNER}/${repo}/readme`));
  } catch {
    continue;
  }

  const text = Buffer.from(readme.content, 'base64').toString('utf8');
  if (hasScreenshotImage(text)) {
    console.log(`OK ${repo}`);
    continue;
  }

  const updated = insertScreenshotBlock(text);
  try {
    updateReadme(repo, updated, readme.sha);
    console.log(`RESTORED ${repo}`);
    restored++;
  } catch (e) {
    console.error(`FAIL ${repo}:`, e.message?.slice(0, 120));
  }
}

console.log(`\nRestored ${restored} repositories.`);

#!/usr/bin/env node
/** Create v1.0.0 (or next patch) GitHub release on repos to trigger GHCR publish. */
import { execSync } from 'child_process';

const OWNER = 'mafzalkalwardev';
const SKIP = new Set(['odysseus', 'mafzalkalwardev']);

function gh(cmd) {
  return execSync(`gh ${cmd}`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();
}

function sleep(ms) {
  execSync(`powershell -Command "Start-Sleep -Milliseconds ${ms}"`, { stdio: 'ignore' });
}

function listRepos() {
  return JSON.parse(gh(`repo list ${OWNER} --limit 100 --json name`)).map((r) => r.name);
}

function hasPublishWorkflow(repo) {
  try {
    gh(`api repos/${OWNER}/${repo}/contents/.github/workflows/publish-docker.yml`);
    return true;
  } catch {
    return false;
  }
}

function latestReleaseTag(repo) {
  try {
    return gh(`api repos/${OWNER}/${repo}/releases/latest --jq .tag_name`);
  } catch {
    return null;
  }
}

function createRelease(repo, tag, title) {
  execSync(
    `gh release create ${tag} --repo ${OWNER}/${repo} --title "${title}" --notes "Automated package release — Docker image published to GHCR on publish."`,
    { stdio: 'pipe' }
  );
}

let released = 0;
for (const repo of listRepos()) {
  if (SKIP.has(repo)) continue;
  if (!hasPublishWorkflow(repo)) {
    console.log(`NO-WORKFLOW ${repo}`);
    continue;
  }

  const latest = latestReleaseTag(repo);
  let tag;
  if (!latest) {
    tag = 'v1.0.0';
  } else if (repo === 'mailforge') {
    console.log(`SKIP ${repo} (already released: ${latest})`);
    continue;
  } else {
    // bump patch for bootstrap package publish
    const m = latest.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
    if (m) {
      tag = `v${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
    } else {
      tag = `${latest}-packages.1`;
    }
  }

  try {
    createRelease(repo, tag, `${tag} — GHCR package`);
    console.log(`RELEASED ${repo} ${tag}`);
    released++;
    sleep(2000);
  } catch (e) {
    const msg = String(e.stderr || e.message || e);
    if (msg.includes('already exists') || msg.includes('Reference already exists')) {
      console.log(`EXISTS ${repo} ${tag}`);
    } else {
      console.error(`FAIL ${repo}:`, msg.slice(0, 120));
    }
    sleep(1500);
  }
}

console.log(`\nCreated ${released} releases.`);

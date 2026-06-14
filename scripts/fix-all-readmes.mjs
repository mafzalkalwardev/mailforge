#!/usr/bin/env node
/**
 * Remove placeholder screenshot refs from all GitHub repos.
 * Keeps only image links to files that exist in docs/screenshots/.
 */
import { execSync } from 'child_process';

const OWNER = 'mafzalkalwardev';
const SKIP = new Set(['odysseus']);

function gh(cmd) {
  return execSync(`gh ${cmd}`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();
}

function listRepos() {
  return JSON.parse(gh(`repo list ${OWNER} --limit 100 --json name`)).map((r) => r.name);
}

function getScreenshotFiles(repo) {
  try {
    const raw = gh(`api repos/${OWNER}/${repo}/contents/docs/screenshots`);
    const items = JSON.parse(raw);
    return items.map((i) => i.name);
  } catch {
    return [];
  }
}

function cleanReadme(text, files) {
  const allowed = new Set(files.filter((f) => f !== 'placeholder.svg' && !f.endsWith('.md')));

  let lines = text.split(/\r?\n/);
  lines = lines.filter((line) => {
    if (/placeholder\.svg/i.test(line)) return false;
    if (/Replace.*placeholder\.svg/i.test(line)) return false;
    const md = line.match(/!\[[^\]]*\]\((docs\/screenshots\/[^)]+)\)/);
    if (md) {
      const name = md[1].split('/').pop();
      return allowed.has(name);
    }
    const html = line.match(/src="(docs\/screenshots\/[^"]+)"/);
    if (html) {
      const name = html[1].split('/').pop();
      return allowed.has(name);
    }
    return true;
  });

  let result = lines.join('\n');

  // Drop Screenshots section if no images remain in it
  result = result.replace(
    /^##[^\n]*Screenshots[^\n]*\n(?:(?!!\[|!\<img|^##).*\n)*/gim,
    (block) => (/!\[|<img/i.test(block) ? block : '')
  );

  // Dedupe duplicate Screenshots headers
  result = result.replace(/(##[^\n]*Screenshots[^\n]*\n)(?:##[^\n]*Screenshots[^\n]*\n)+/g, '$1');

  // Remove broken nav line with Screenshots link
  result = result.replace(/^\[Features\][^\n]*Screenshots[^\n]*\n/gm, '');

  return result.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function updateReadme(repo, content, sha) {
  const b64 = Buffer.from(content, 'utf8').toString('base64');
  const payload = JSON.stringify({
    message: 'docs: remove placeholder screenshots from README',
    content: b64,
    sha,
  });
  execSync(`gh api -X PUT repos/${OWNER}/${repo}/contents/README.md --input -`, {
    input: payload,
    encoding: 'utf8',
  });
}

function deletePlaceholderFile(repo) {
  try {
    const meta = JSON.parse(
      gh(`api repos/${OWNER}/${repo}/contents/docs/screenshots/placeholder.svg`)
    );
    const payload = JSON.stringify({
      message: 'docs: remove placeholder.svg',
      sha: meta.sha,
    });
    execSync(
      `gh api -X DELETE repos/${OWNER}/${repo}/contents/docs/screenshots/placeholder.svg --input -`,
      { input: payload, encoding: 'utf8' }
    );
    console.log(`  deleted placeholder.svg in ${repo}`);
  } catch {
    // file not present
  }
}

const repos = listRepos();
let fixed = 0;

for (const repo of repos) {
  if (SKIP.has(repo)) continue;

  let readme;
  try {
    readme = JSON.parse(gh(`api repos/${OWNER}/${repo}/readme`));
  } catch {
    continue;
  }

  const text = Buffer.from(readme.content, 'base64').toString('utf8');
  if (!/placeholder\.svg|docs\/screenshots/i.test(text)) {
    console.log(`SKIP ${repo}`);
    continue;
  }

  const files = getScreenshotFiles(repo);
  const cleaned = cleanReadme(text, files);

  if (cleaned === text) {
    console.log(`UNCHANGED ${repo}`);
    deletePlaceholderFile(repo);
    continue;
  }

  try {
    updateReadme(repo, cleaned, readme.sha);
    deletePlaceholderFile(repo);
    console.log(`FIXED ${repo}`);
    fixed++;
  } catch (e) {
    console.error(`FAIL ${repo}:`, e.message?.slice(0, 120));
  }
}

console.log(`\nFixed ${fixed} repositories.`);

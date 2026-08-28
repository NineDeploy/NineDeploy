import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const newVersion = process.argv[2];
if (!newVersion || !/^\d+\.\d+\.\d+.*$/.test(newVersion)) {
  console.error('Usage: node scripts/bump-version.js <version> (e.g. 0.2.3)');
  process.exit(1);
}

const rootDir = process.cwd();

/** Resolve a repo-relative path and refuse anything that escapes the repo
 * root — defense-in-depth even though every caller passes a fixed literal. */
function resolveInRoot(rel) {
  const target = path.resolve(rootDir, rel);
  if (!target.startsWith(rootDir + path.sep)) {
    throw new Error(`Refusing path outside the repo root: ${rel}`);
  }
  return target;
}

// 1. All package.json files
const packageJsons = [
  'package.json',
  'apps/cli/package.json',
  'apps/server/package.json',
  'apps/web/package.json',
  'packages/db/package.json',
  'packages/mcp/package.json',
  'packages/plugin-sdk/package.json',
  'packages/schemas/package.json',
  'packages/sdk/package.json',
  'website/package.json',
];

for (const rel of packageJsons) {
  const file = resolveInRoot(rel);
  const json = JSON.parse(readFileSync(file, 'utf8'));
  json.version = newVersion;
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`✓ Updated ${rel} → ${newVersion}`);
}

// 2. Code files with hardcoded version strings
function replaceInFile(rel, regex, replacement) {
  const file = resolveInRoot(rel);
  const content = readFileSync(file, 'utf8');
  // Report the truth instead of a green tick: a pattern that matches nothing
  // silently rots the file while this script claims it was synchronized.
  if (!regex.test(content)) {
    console.warn(`⚠ ${rel}: pattern did not match anything — file left untouched`);
    return;
  }
  writeFileSync(file, content.replace(regex, replacement));
  console.log(`✓ Synchronized ${rel}`);
}

replaceInFile('apps/server/src/version.ts', /export const VERSION = '.*?';/, `export const VERSION = '${newVersion}';`);
// NOTE: do NOT add a `/version: '.*?',/` rule for version.ts here — that shape
// is the ChangelogEntry literal inside the file, and rewriting its FIRST
// occurrence would relabel the newest changelog entry instead of anything
// meant to track the released version. ABOUT.version reads the VERSION
// constant, so there is nothing else to sync in that file.
replaceInFile('apps/cli/src/index.ts', /\.version\('.*?'\)/, `.version('${newVersion}')`);
replaceInFile('packages/mcp/src/index.ts', /version: '.*?'/, `version: '${newVersion}'`);
replaceInFile('apps/web/src/routes/About.tsx', /--version v\d+\.\d+\.\d+/g, `--version v${newVersion}`);
replaceInFile('docs/QUICKSTART.md', /--version v\d+\.\d+\.\d+/g, `--version v${newVersion}`);
replaceInFile('website/src/pages/Home.tsx', /<span className="tag font-bold">v\d+\.\d+\.\d+<\/span>/, `<span className="tag font-bold">v${newVersion}</span>`);
replaceInFile('website/src/components/Layout.tsx', /v\d+\.\d+\.\d+ GA/g, `v${newVersion} GA`);
replaceInFile('README.md', /Version-\d+\.\d+\.\d+-blue/, `Version-${newVersion}-blue`);

console.log(`\n🎉 Successfully bumped all monorepo packages and code to v${newVersion}\n`);

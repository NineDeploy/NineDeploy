import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const newVersion = process.argv[2];
if (!newVersion || !/^\d+\.\d+\.\d+.*$/.test(newVersion)) {
  console.error('Usage: node scripts/bump-version.js <version> (e.g. 0.2.3)');
  process.exit(1);
}

const rootDir = process.cwd();

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
  const file = path.join(rootDir, rel);
  const json = JSON.parse(readFileSync(file, 'utf8'));
  json.version = newVersion;
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  console.log(`✓ Updated ${rel} → ${newVersion}`);
}

// 2. Code files with hardcoded version strings
function replaceInFile(rel, regex, replacement) {
  const file = path.join(rootDir, rel);
  const content = readFileSync(file, 'utf8');
  const updated = content.replace(regex, replacement);
  writeFileSync(file, updated);
  console.log(`✓ Synchronized ${rel}`);
}

replaceInFile('apps/server/src/version.ts', /export const VERSION = '.*?';/, `export const VERSION = '${newVersion}';`);
replaceInFile('apps/server/src/version.ts', /version: '.*?',/, `version: '${newVersion}',`);
replaceInFile('apps/server/test/health.test.ts', /expect\(body\.version\)\.toBe\('.*?'\);/, `expect(body.version).toBe('${newVersion}');`);
replaceInFile('apps/cli/src/index.ts', /\.version\('.*?'\)/, `.version('${newVersion}')`);
replaceInFile('packages/mcp/src/index.ts', /version: '.*?'/, `version: '${newVersion}'`);
replaceInFile('apps/web/src/routes/About.tsx', /--version v\d+\.\d+\.\d+/g, `--version v${newVersion}`);
replaceInFile('docs/QUICKSTART.md', /--version v\d+\.\d+\.\d+/g, `--version v${newVersion}`);
replaceInFile('website/src/pages/Home.tsx', /<span className="tag font-bold">v\d+\.\d+\.\d+<\/span>/, `<span className="tag font-bold">v${newVersion}</span>`);
replaceInFile('website/src/components/Layout.tsx', /v\d+\.\d+\.\d+ GA/g, `v${newVersion} GA`);

console.log(`\n🎉 Successfully bumped all monorepo packages and code to v${newVersion}\n`);

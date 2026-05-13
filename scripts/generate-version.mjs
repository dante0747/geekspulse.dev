/**
 * generate-version.mjs
 * Reads git commit count + short hash and writes public/version.json.
 * Run via: node scripts/generate-version.mjs
 */

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function git(cmd) {
  try {
    return execSync(cmd, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

const commitCount = parseInt(git('git rev-list --count HEAD') ?? '0', 10);
const shortHash   = git('git rev-parse --short HEAD') ?? 'unknown';
const commitDate  = git('git log -1 --format=%cs')    ?? new Date().toISOString().slice(0, 10);

// Semantic-ish version: v1.0.<commit_count>
const version = `v1.0.${commitCount}`;

const payload = {
  version,
  commit:  shortHash,
  date:    commitDate,
  build:   commitCount,
};

mkdirSync(join(root, 'public'), { recursive: true });
writeFileSync(
  join(root, 'public', 'version.json'),
  JSON.stringify(payload, null, 2) + '\n',
  'utf8'
);

console.log(`[generate-version] ${version} (${shortHash}) — ${commitDate}`);


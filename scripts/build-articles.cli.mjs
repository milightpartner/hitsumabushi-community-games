// Builds the game guide site into dist-articles/ (or --out <dir>).
//
//   npm run build:articles
//
// Every games/<gameId>/guide.md that passes validateGuide() is published. No network access:
// the portal decides which guides it links to, not this build (OmoshiroGamePortal#382).
//
// A guide's publish date is when its guide.md was first committed to this repo, read from git
// history - so the build needs full history (actions/checkout with fetch-depth: 0). In a shallow
// clone every file looks newly added, so dates are omitted there rather than shown wrong.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildArticles } from './build-articles.mjs';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outDir = outIndex >= 0 ? args[outIndex + 1] : 'dist-articles';

function git(...gitArgs) {
  return execFileSync('git', gitArgs, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

let historyAvailable = false;
try {
  historyAvailable = git('rev-parse', '--is-shallow-repository') === 'false';
} catch {
  // not a git checkout
}
if (!historyAvailable) console.warn('⚠️  gitの履歴が無い(shallow clone等)ため、公開日を出力しません。');

function firstCommittedAt(file) {
  if (!historyAvailable) return null;
  try {
    const dates = git('log', '--diff-filter=A', '--follow', '--format=%cI', '--', file).split('\n').filter(Boolean);
    return dates.at(-1) ?? null; // oldest; null for a guide.md that isn't committed yet
  } catch {
    return null;
  }
}

function readGames() {
  return fs
    .readdirSync('games', { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join('games', d.name, 'guide.md')))
    .map((d) => {
      let manifest = null;
      try {
        manifest = JSON.parse(fs.readFileSync(path.join('games', d.name, 'manifest.json'), 'utf-8'));
      } catch {
        // validateGuide still runs; the page just falls back to the gameId for the game's name.
      }
      const guidePath = path.posix.join('games', d.name, 'guide.md');
      return { gameId: d.name, guideText: fs.readFileSync(guidePath, 'utf-8'), manifest, publishedAt: firstCommittedAt(guidePath) };
    });
}

function readFileSize(p) {
  try {
    const stat = fs.statSync(p);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

let creators = {};
try {
  creators = JSON.parse(fs.readFileSync('creators.json', 'utf-8'));
} catch {
  // no team creators - articles credit the creatorGithub login as-is
}

const result = buildArticles({ games: readGames(), readFileSize, creators });

fs.rmSync(outDir, { recursive: true, force: true });
for (const { path: p, content } of result.files) {
  const dest = path.join(outDir, p);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
}
for (const { from, to } of result.copies) {
  const dest = path.join(outDir, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(from, dest);
}

for (const { gameId, reasons } of result.skipped) {
  console.warn(`⚠️  ${gameId}: 記事を出力しませんでした`);
  for (const r of reasons) console.warn(`    - ${r}`);
}
console.log(`✅ ${result.articles.length}件の記事を ${outDir}/ に出力しました。`);

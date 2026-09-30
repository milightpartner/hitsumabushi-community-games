// Builds the game guide site into dist-articles/ (or --out <dir>).
//
//   npm run build:articles
//
// Every games/<gameId>/guide.md that passes validateGuide() is published. No network access:
// the portal decides which guides it links to, not this build (OmoshiroGamePortal#382).
import fs from 'node:fs';
import path from 'node:path';
import { buildArticles } from './build-articles.mjs';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outDir = outIndex >= 0 ? args[outIndex + 1] : 'dist-articles';

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
      return { gameId: d.name, guideText: fs.readFileSync(path.join('games', d.name, 'guide.md'), 'utf-8'), manifest };
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

const result = buildArticles({ games: readGames(), readFileSize });

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

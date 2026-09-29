// Builds the article site into dist-articles/ (or --out <dir>).
//
//   npm run build:articles          # production: only games the portal catalog lists as active
//                                   # and whose catalog url points at this repo's copy
//   npm run build:articles -- --all # local check: every game with a guide.md, no network needed
//
// The catalog is read from the portal's Firestore `games` collection, which is publicly readable
// (firestore.rules: `allow read: if true`), so no credentials are involved. If it can't be read the
// build fails rather than guessing - publishing an article for a game the portal has pulled
// (e.g. an emergency `maintenance`) is exactly what the catalog check exists to prevent.
import fs from 'node:fs';
import path from 'node:path';
import { buildArticles } from './build-articles.mjs';

const CATALOG_URL = 'https://firestore.googleapis.com/v1/projects/hitu-mabusi/databases/(default)/documents/games';
const COMMUNITY_GAMES_BASE_URL = 'https://hitu-mabusi-community.web.app';

const args = process.argv.slice(2);
const includeAll = args.includes('--all');
const outIndex = args.indexOf('--out');
const outDir = outIndex >= 0 ? args[outIndex + 1] : 'dist-articles';

// A game counts as published only if the catalog entry is active AND actually points at this
// repository's copy of it. Without the URL check, a new submission reusing an existing catalog id
// (e.g. games/unstoppable/) would get an official-looking article whose CTA opens someone else's game.
async function fetchPublishedGameIds() {
  const published = new Set();
  let pageToken = '';
  do {
    const url = `${CATALOG_URL}?pageSize=300&mask.fieldPaths=status&mask.fieldPaths=url${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`カタログの取得に失敗しました (HTTP ${res.status})`);
    const body = await res.json();
    for (const doc of body.documents ?? []) {
      const gameId = doc.name.split('/').pop();
      const catalogUrl = (doc.fields?.url?.stringValue ?? '').replace(/\/+$/, '');
      if (doc.fields?.status?.stringValue === 'active' && catalogUrl === `${COMMUNITY_GAMES_BASE_URL}/${gameId}`) {
        published.add(gameId);
      }
    }
    pageToken = body.nextPageToken ?? '';
  } while (pageToken);
  return published;
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

let isPublished = () => true;
if (!includeAll) {
  try {
    const published = await fetchPublishedGameIds();
    isPublished = (gameId) => published.has(gameId);
  } catch (err) {
    console.error(`❌ ${err.message}。記事サイトはビルドしません(--all で全記事を出力できます)。`);
    process.exit(1);
  }
}

const result = buildArticles({ games: readGames(), isPublished, readFileSize });

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
console.log(`✅ ${result.articles.length}件の記事を ${outDir}/ に出力しました${includeAll ? '(--all: カタログ未確認)' : ''}。`);

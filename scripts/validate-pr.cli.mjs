// CI entry point: gathers the real git diff / file contents and hands them to the pure
// validatePr() logic in validate-pr.mjs. Requires the workflow to have fetched `origin/main`
// (actions/checkout with fetch-depth: 0, or an explicit `git fetch origin main`) so both
// `git diff` and `git show origin/main:...` can resolve the base branch.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { validatePr } from './validate-pr.mjs';

const baseRef = process.env.BASE_REF || 'origin/main';
const prAuthor = process.env.PR_AUTHOR;

if (!prAuthor) {
  console.error('PR_AUTHOR environment variable is required (the PR author\'s GitHub login).');
  process.exit(1);
}

const changedFiles = execSync(`git diff --name-only ${baseRef}...HEAD`, { encoding: 'utf-8' })
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean);

function readJson(path) {
  try {
    return { value: JSON.parse(fs.readFileSync(path, 'utf-8')), malformed: false };
  } catch (err) {
    if (err.code === 'ENOENT') return { value: null, malformed: false };
    return { value: null, malformed: true };
  }
}

function readGitJson(ref, path) {
  let content;
  try {
    content = execSync(`git show ${ref}:${path}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
  } catch {
    return { value: null, malformed: false }; // doesn't exist at that ref - a new game
  }
  try {
    return { value: JSON.parse(content), malformed: false };
  } catch {
    return { value: null, malformed: true };
  }
}

let headMalformedPath = null;
function readHeadManifest(gameId) {
  const { value, malformed } = readJson(`games/${gameId}/manifest.json`);
  if (malformed) headMalformedPath = `games/${gameId}/manifest.json`;
  return value;
}

function readBaseManifest(gameId) {
  const { value } = readGitJson(baseRef, `games/${gameId}/manifest.json`);
  return value;
}

function readHeadFileText(path) {
  try {
    return fs.readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

if (headMalformedPath) {
  console.error(`❌ ${headMalformedPath} が正しいJSONとして読み込めません。構文を確認してください。`);
  process.exit(1);
}

const result = validatePr({ changedFiles, prAuthor, readBaseManifest, readHeadManifest, readHeadFileText });

if (!result.ok) {
  console.error('❌ PR検証に失敗しました:\n');
  for (const e of result.errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`✅ games/${result.gameId}/ の変更を検証しました。問題ありません。`);

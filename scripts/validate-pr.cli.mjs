// CI entry point: gathers the real git diff / file contents and hands them to the pure
// validatePr() logic in validate-pr.mjs. Requires the workflow to have fetched `origin/main`
// (actions/checkout with fetch-depth: 0, or an explicit `git fetch origin main`) so both
// `git diff` and `git show origin/main:...` can resolve the base branch.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import Ajv from 'ajv';
import { validatePr } from './validate-pr.mjs';

// The SDK's JSON Schema is authored and versioned in OmoshiroGamePortal (a private repo), so it
// can't be pulled in as an npm dependency here without exposing a registry token to fork PRs -
// this repo's whole CI design deliberately avoids that (see pr-validate.yml). It's fetched from
// its public hosting URL instead, which needs no auth and always reflects the schema actually
// live on the Portal. See OmoshiroGamePortal#249 for the background.
const MANIFEST_SCHEMA_URL = 'https://milightpartner.jp/schemas/game-manifest-1.json';

async function loadManifestSchemaValidator() {
  let schema;
  try {
    const res = await fetch(MANIFEST_SCHEMA_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    schema = await res.json();
  } catch (err) {
    console.error(`❌ SDKのJSON Schema (${MANIFEST_SCHEMA_URL}) の取得に失敗しました: ${err.message}`);
    console.error('   ネットワーク接続を確認するか、時間をおいて再実行してください。');
    process.exit(1);
  }
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  return (manifest) => (validate(manifest) ? [] : validate.errors.map((e) => `${e.instancePath || '(root)'} ${e.message}`));
}

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

function readHeadFileSize(path) {
  try {
    const stat = fs.statSync(path);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

if (headMalformedPath) {
  console.error(`❌ ${headMalformedPath} が正しいJSONとして読み込めません。構文を確認してください。`);
  process.exit(1);
}

// Read from the base branch, not the PR: membership must never come from the PR being checked.
const { value: creators, malformed: creatorsMalformed } = readGitJson(baseRef, 'creators.json');
if (creatorsMalformed) {
  console.error(`❌ ${baseRef} の creators.json が正しいJSONとして読み込めません。`);
  process.exit(1);
}

const validateManifestSchema = await loadManifestSchemaValidator();

const result = validatePr({
  changedFiles,
  prAuthor,
  readBaseManifest,
  readHeadManifest,
  validateManifestSchema,
  readHeadFileText,
  readHeadFileSize,
  creators: creators ?? {},
});

if (!result.ok) {
  console.error('❌ PR検証に失敗しました:\n');
  for (const e of result.errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`✅ games/${result.gameId}/ の変更を検証しました。問題ありません。`);

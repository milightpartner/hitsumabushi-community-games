// Pure validation logic for a community-games PR, kept separate from any I/O so it can be
// unit-tested without a real git checkout or GitHub API call. See validate-pr.cli.mjs for the
// actual CI entry point that gathers changedFiles/readBaseManifest/readHeadManifest/
// validateManifestSchema for real.
//
// manifest.json's *shape* (required fields, enums, version format, additionalProperties, ...) is
// not re-implemented here - that duplication is what let this file and the SDK's JSON Schema
// (packages/hitsumabushi-sdk/schemas/manifest.schema.json in OmoshiroGamePortal, published at
// https://milightpartner.jp/schemas/game-manifest-1.json) drift apart (OmoshiroGamePortal#249).
// It is delegated to the injected `validateManifestSchema`. What stays here is business logic
// that is specific to *this* repo and has no business being in a generic manifest schema: the
// games/<gameId>/ directory-naming convention, creatorGithub ownership rules, and the
// dev-harness-path footgun check, plus guide.md (validate-guide.mjs).
import { canActFor } from './creators.mjs';
import { validateGuide } from './validate-guide.mjs';

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * @param {object} params
 * @param {string[]} params.changedFiles - paths changed by the PR, relative to repo root.
 * @param {string} params.prAuthor - PR author's GitHub login.
 * @param {(gameId: string) => object | null} params.readBaseManifest - reads
 *   `games/<gameId>/manifest.json` as parsed JSON from the PR's base (main) branch, or null if
 *   the game doesn't exist there yet (brand new submission).
 * @param {(gameId: string) => object | null} params.readHeadManifest - same, but from the PR's
 *   HEAD (the content the PR is proposing). null if the PR deletes the manifest entirely.
 * @param {(manifest: object) => string[]} params.validateManifestSchema - validates a manifest
 *   against the SDK's JSON Schema (the machine source of truth for its shape) and returns a list
 *   of human-readable violation strings, or an empty array if it conforms.
 * @param {(path: string) => string | null} params.readHeadFileText - reads an arbitrary changed
 *   file's raw text content from the PR's HEAD, or null if it doesn't exist / isn't text.
 * @param {(path: string) => number | null} [params.readHeadFileSize] - size in bytes of a file at
 *   the PR's HEAD, or null if it doesn't exist. Used for guide.md's image checks.
 * @param {import('./creators.mjs').Creators} [params.creators] - team creators (creators.json as
 *   of the base branch, so a PR can't grant itself membership).
 * @returns {{ ok: boolean, errors: string[], gameId: string | null }}
 */
export function validatePr({ changedFiles, prAuthor, readBaseManifest, readHeadManifest, validateManifestSchema, readHeadFileText, readHeadFileSize, creators = {} }) {
  const errors = [];

  if (!changedFiles || changedFiles.length === 0) {
    return { ok: false, errors: ['変更されたファイルがありません。'], gameId: null };
  }

  const outsideGames = changedFiles.filter((f) => !f.startsWith('games/'));
  if (outsideGames.length > 0) {
    errors.push(`games/ 以外のファイルは変更できません: ${outsideGames.join(', ')}`);
  }

  const gameIds = new Set(
    changedFiles
      .filter((f) => f.startsWith('games/'))
      .map((f) => f.split('/')[1])
      .filter(Boolean),
  );

  if (gameIds.size === 0) {
    errors.push('games/<gameId>/ 配下のファイルが含まれていません。');
    return { ok: false, errors, gameId: null };
  }
  if (gameIds.size > 1) {
    errors.push(`1つのPRで変更できるのは1ゲームのみです。複数のゲームが変更されています: ${[...gameIds].join(', ')}`);
    return { ok: false, errors, gameId: null };
  }

  const gameId = [...gameIds][0];
  if (!ID_RE.test(gameId)) {
    errors.push(`ゲームID "${gameId}" は半角英数小文字とハイフンのみ(kebab-case)である必要があります。`);
  }

  const headManifest = readHeadManifest(gameId);
  if (!headManifest) {
    errors.push(`games/${gameId}/manifest.json が見つかりません。`);
    return { ok: errors.length === 0, errors, gameId };
  }

  // --- manifest.json schema (SDK's JSON Schema is the source of truth - see module doc above) ---
  if (headManifest.gameId !== gameId) {
    errors.push(`manifest.json の gameId ("${headManifest.gameId}") がディレクトリ名 ("${gameId}") と一致しません。`);
  }
  const schemaErrors = validateManifestSchema(headManifest);
  if (schemaErrors.length > 0) {
    errors.push(
      `manifest.json がSDKのJSON Schema (https://milightpartner.jp/schemas/game-manifest-1.json) に違反しています:\n  - ${schemaErrors.join('\n  - ')}`,
    );
  }
  // max < min is a cross-field constraint plain JSON Schema can't express, so the SDK schema
  // doesn't check it either (see manifestSchema.test.js in OmoshiroGamePortal) - checked here
  // instead of being left unverified.
  const players = headManifest.players;
  if (players && typeof players.min === 'number' && typeof players.max === 'number' && players.max < players.min) {
    errors.push('manifest.json の players.max は players.min 以上である必要があります。');
  }

  // --- ownership check: prevents editing someone else's game directory ---
  // creatorGithub is either the submitter's own login or a team from creators.json (creators.mjs).
  const baseManifest = readBaseManifest(gameId);
  if (baseManifest) {
    // Existing game: ownership was fixed at creation time and can't be reassigned by an edit PR.
    if (baseManifest.creatorGithub && !canActFor(baseManifest.creatorGithub, prAuthor, creators)) {
      errors.push(
        `games/${gameId}/ は "${baseManifest.creatorGithub}" が作成したゲームです。別のGitHubユーザー("${prAuthor}")からは変更できません。`,
      );
    }
    if (headManifest.creatorGithub && headManifest.creatorGithub !== baseManifest.creatorGithub) {
      errors.push('manifest.json の creatorGithub は後から変更できません。');
    }
  } else {
    // New game: the submitter is free to claim it, but must claim it as themselves.
    if (typeof headManifest.creatorGithub !== 'string' || !headManifest.creatorGithub.trim()) {
      errors.push('新規ゲームの manifest.json には creatorGithub (あなたのGitHubユーザー名) が必須です。');
    } else if (!canActFor(headManifest.creatorGithub, prAuthor, creators)) {
      errors.push(`manifest.json の creatorGithub ("${headManifest.creatorGithub}") はPR作成者("${prAuthor}")と一致している必要があります。`);
    }
  }

  // --- dev-harness-only SDK path check ---
  // `/__hitsumabushi_dev__/sdk.js` only exists while `npx hitsumabushi dev` is running - a game
  // deployed with an import map still pointing at it looks fine locally but silently never calls
  // Hitsumabushi.init() once live (that path 404s on any real host). This exact bug shipped once
  // (games/just-10-seconds) before this check existed. The fix is the public-URL <script> tag
  // (OmoshiroGamePortal#223/#224) - not vendoring the SDK into the game repo.
  if (typeof readHeadFileText === 'function') {
    for (const file of changedFiles) {
      if (!file.startsWith(`games/${gameId}/`) || !file.endsWith('.html')) continue;
      const content = readHeadFileText(file);
      if (content && content.includes('__hitsumabushi_dev__')) {
        errors.push(
          `${file} が開発ハーネス専用パス(/__hitsumabushi_dev__/sdk.js)を参照しています。本番では404になりゲームが反応しなくなります。`
          + ' <script src="https://milightpartner.jp/sdk/hitsumabushi-sdk.js"></script> を使う形に書き換えてコミットしてください。',
        );
      }
    }
  }

  // --- guide.md (optional explainer article) ---
  // Checked whenever it exists at HEAD, not only when this PR changed it, so the game is never
  // deployed next to a guide that no longer passes the current rules.
  if (typeof readHeadFileText === 'function') {
    const guideText = readHeadFileText(`games/${gameId}/guide.md`);
    if (guideText !== null && guideText !== undefined) {
      errors.push(...validateGuide({ gameId, text: guideText, readFileSize: readHeadFileSize }));
    }
  }

  return { ok: errors.length === 0, errors, gameId };
}

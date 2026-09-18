// Pure validation logic for a community-games PR, kept separate from any I/O so it can be
// unit-tested without a real git checkout or GitHub API call. See validate-pr.cli.mjs for the
// actual CI entry point that gathers changedFiles/readBaseManifest/readHeadManifest for real.

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PLAYERS_TYPES = ['fixed', 'variable'];
const RESULT_TYPES = ['single_winner', 'ranked', 'score'];

/**
 * @param {object} params
 * @param {string[]} params.changedFiles - paths changed by the PR, relative to repo root.
 * @param {string} params.prAuthor - PR author's GitHub login.
 * @param {(gameId: string) => object | null} params.readBaseManifest - reads
 *   `games/<gameId>/manifest.json` as parsed JSON from the PR's base (main) branch, or null if
 *   the game doesn't exist there yet (brand new submission).
 * @param {(gameId: string) => object | null} params.readHeadManifest - same, but from the PR's
 *   HEAD (the content the PR is proposing). null if the PR deletes the manifest entirely.
 * @returns {{ ok: boolean, errors: string[], gameId: string | null }}
 */
export function validatePr({ changedFiles, prAuthor, readBaseManifest, readHeadManifest }) {
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

  // --- manifest.json schema ---
  if (headManifest.gameId !== gameId) {
    errors.push(`manifest.json の gameId ("${headManifest.gameId}") がディレクトリ名 ("${gameId}") と一致しません。`);
  }
  if (typeof headManifest.title !== 'string' || !headManifest.title.trim()) {
    errors.push('manifest.json の title が必須です。');
  }
  const players = headManifest.players || {};
  if (typeof players.min !== 'number' || typeof players.max !== 'number' || players.min < 1 || players.max < players.min) {
    errors.push('manifest.json の players.min/max が不正です。');
  }
  if (!PLAYERS_TYPES.includes(players.type)) {
    errors.push(`manifest.json の players.type は ${PLAYERS_TYPES.join(' / ')} のいずれかである必要があります。`);
  }
  const resultModel = headManifest.resultModel || {};
  if (!RESULT_TYPES.includes(resultModel.type)) {
    errors.push(`manifest.json の resultModel.type は ${RESULT_TYPES.join(' / ')} のいずれかである必要があります。`);
  }

  // --- ownership check: prevents editing someone else's game directory ---
  const baseManifest = readBaseManifest(gameId);
  if (baseManifest) {
    // Existing game: ownership was fixed at creation time and can't be reassigned by an edit PR.
    if (baseManifest.creatorGithub && baseManifest.creatorGithub.toLowerCase() !== prAuthor.toLowerCase()) {
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
    } else if (headManifest.creatorGithub.toLowerCase() !== prAuthor.toLowerCase()) {
      errors.push(`manifest.json の creatorGithub ("${headManifest.creatorGithub}") はPR作成者("${prAuthor}")と一致している必要があります。`);
    }
  }

  return { ok: errors.length === 0, errors, gameId };
}

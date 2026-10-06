// Recognizes the automated hitsudoc version bump PR (OmoshiroGamePortal#448).
//
// The portal's scheduled E2E job opens it through the milightpartner GitHub App once the E2E run
// passes. The App's bot account isn't an org member, so without this the PR would be checked as an
// untrusted submission and rejected for touching a file outside games/. Only that bot, and only a
// PR whose sole change is the pinned version on the hitsudoc install line, is let through - any
// other change from the bot falls back to the normal submission rules.

export const BUILD_GUIDES_ACTION = '.github/actions/build-guides/action.yml';

const VERSION_SOURCE = String.raw`(@milightpartner/hitsudoc@)\d+\.\d+\.\d+`;

/**
 * @param {object} params
 * @param {string} params.prAuthor - the PR author's login
 * @param {string | undefined} params.botLogin - the GitHub App's bot login (`<app-slug>[bot]`);
 *   when unset, no PR is treated as a bump
 * @param {string[]} params.changedFiles
 * @param {string | null} params.baseText - build-guides/action.yml on the base branch
 * @param {string | null} params.headText - build-guides/action.yml in the PR
 * @returns {boolean}
 */
export function isHitsudocBumpPr({ prAuthor, botLogin, changedFiles, baseText, headText }) {
  if (!botLogin || prAuthor !== botLogin) return false;
  if (changedFiles.length !== 1 || changedFiles[0] !== BUILD_GUIDES_ACTION) return false;
  if (baseText == null || headText == null || baseText === headText) return false;
  // Identical once the version numbers are masked out = nothing but the version changed.
  // (A fresh RegExp each time: a shared /g regex keeps lastIndex between .test() calls.)
  const mask = (text) => text.replace(new RegExp(VERSION_SOURCE, 'g'), '$1X.Y.Z');
  return mask(baseText) === mask(headText) && new RegExp(VERSION_SOURCE).test(headText);
}

// Pure validation logic for games/<gameId>/guide.md (the game's explainer article), kept
// separate from any I/O like validate-pr.mjs. Called from validatePr() whenever the PR's game
// has a guide.md at HEAD - even if this PR didn't touch it - so a game can never be deployed
// alongside an invalid guide.
//
// guide.md is turned into an HTML article page served under a Milight domain
// (guide.milightpartner.jp, OmoshiroGamePortal#382), so unlike a game's own JS it must never
// be able to carry markup or scripts of its own. This check is the early, friendly feedback
// layer; the article build must still render Markdown without passing raw HTML through.
import matter from 'gray-matter';
import { fromMarkdown } from 'mdast-util-from-markdown';

export const GUIDE_LIMITS = {
  maxFileBytes: 50 * 1024,
  maxImageBytes: 500 * 1024,
  maxTitleLength: 60,
  // Used as the page's <meta name="description">, which search engines truncate around here.
  maxDescriptionLength: 120,
};

const ALLOWED_KEYS = ['gameId', 'title', 'description', 'quickRules'];

// Keys an existing article pipeline understands but a creator must not set themselves - e.g.
// `slug` could collide with (hijack) another article's URL, `author` could impersonate someone.
const RESERVED_KEY_REASONS = {
  slug: '記事のURLはゲームIDから自動で決まります',
  category: 'カテゴリは自動で決まります',
  author: 'なりすまし防止のため、作者名は manifest.json の creatorGithub から決まります',
  isStaging: '公開状態は運営が管理します',
  draft: '公開状態は運営が管理します',
  publishedAt: '公開日時は自動で決まります',
};

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

/**
 * @param {object} params
 * @param {string} params.gameId - the game directory name (already validated by validatePr).
 * @param {string} params.text - raw guide.md content.
 * @param {(path: string) => number | null} [params.readFileSize] - size in bytes of a file at the
 *   PR's HEAD (repo-root-relative path), or null if it doesn't exist. When omitted, image
 *   existence/size checks are skipped.
 * @returns {string[]} error messages (empty when valid).
 */
export function validateGuide({ gameId, text, readFileSize }) {
  const errors = [];
  const file = `games/${gameId}/guide.md`;

  const bytes = new TextEncoder().encode(text).length;
  if (bytes > GUIDE_LIMITS.maxFileBytes) {
    errors.push(`${file} が大きすぎます(${formatKb(bytes)})。${formatKb(GUIDE_LIMITS.maxFileBytes)}以下にしてください。`);
  }

  let parsed;
  try {
    // gray-matter caches by input string; passing an options object disables that cache so a
    // previous (possibly malformed) parse can never leak into this one.
    parsed = matter(text, {});
  } catch (err) {
    errors.push(`${file} の先頭の --- で囲まれた部分(frontmatter)がYAMLとして読み込めません: ${firstLine(err.message)}`);
    return errors;
  }

  const data = parsed.data;
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length === 0) {
    errors.push(`${file} の先頭に --- で囲まれた frontmatter (gameId / title / description) が必要です。`);
    return errors;
  }

  // --- frontmatter keys ---
  for (const key of Object.keys(data)) {
    if (ALLOWED_KEYS.includes(key)) continue;
    const reason = RESERVED_KEY_REASONS[key];
    errors.push(
      reason
        ? `${file} の frontmatter に ${key} は指定できません。${reason}。`
        : `${file} の frontmatter に未対応の項目 ${key} があります。使える項目は ${ALLOWED_KEYS.join(' / ')} です。`,
    );
  }

  if (data.gameId !== gameId) {
    errors.push(`${file} の gameId ("${data.gameId ?? ''}") がディレクトリ名 ("${gameId}") と一致しません。`);
  }
  checkRequiredText(errors, file, data, 'title', GUIDE_LIMITS.maxTitleLength);
  checkRequiredText(errors, file, data, 'description', GUIDE_LIMITS.maxDescriptionLength);

  // --- quickRules (the in-game rules panel) ---
  if (data.quickRules !== undefined) {
    if (typeof data.quickRules !== 'string' || !data.quickRules.trim()) {
      errors.push(`${file} の quickRules は文字列で指定してください(不要なら項目ごと削除してください)。`);
    } else {
      const tree = fromMarkdown(data.quickRules);
      visit(tree, (node) => {
        if (node.type === 'heading' && node.depth !== 2 && node.depth !== 3) {
          errors.push(
            `${file} の quickRules の見出しは ## (常に表示) か ### (タップで開閉) だけが使えます: "${'#'.repeat(node.depth)} ${plainText(node)}"`,
          );
        }
      });
      checkMarkdownContent(errors, `${file} の quickRules`, tree, { gameId, readFileSize, lineOffset: null });
    }
  }

  // --- article body ---
  const bodyLineOffset = countLines(text.slice(0, text.length - parsed.content.length)) - 1;
  checkMarkdownContent(errors, file, fromMarkdown(parsed.content), { gameId, readFileSize, lineOffset: bodyLineOffset });

  return errors;
}

function checkRequiredText(errors, file, data, key, maxLength) {
  const value = data[key];
  if (typeof value !== 'string' || !value.trim()) {
    errors.push(`${file} の ${key} が必須です。`);
    return;
  }
  const length = [...value.trim()].length;
  if (length > maxLength) {
    errors.push(`${file} の ${key} が長すぎます(${length}文字)。${maxLength}文字以内にしてください。`);
  }
}

/**
 * Checks a parsed Markdown tree for raw HTML, disallowed link targets and invalid images.
 * @param {number | null} lineOffset - added to node line numbers for error messages; null to omit
 *   line numbers (quickRules, whose lines don't map 1:1 to the file).
 */
function checkMarkdownContent(errors, label, tree, { gameId, readFileSize, lineOffset }) {
  const at = (node) => (lineOffset === null || !node.position ? '' : ` (${node.position.start.line + lineOffset}行目)`);

  const definitions = new Map();
  visit(tree, (node) => {
    if (node.type === 'definition') definitions.set(node.identifier, node);
  });

  visit(tree, (node) => {
    switch (node.type) {
      case 'html': {
        // HTML comments are harmless (the starter template ships one); anything else is markup.
        const withoutComments = node.value.replace(/<!--[\s\S]*?-->/g, '').trim();
        if (withoutComments) {
          errors.push(`${label} にHTMLタグは書けません${at(node)}: ${truncate(withoutComments)}。Markdownの記法だけを使ってください。`);
        }
        break;
      }
      case 'link':
        checkLinkUrl(errors, label, node.url, at(node));
        break;
      case 'linkReference': {
        const def = definitions.get(node.identifier);
        if (def) checkLinkUrl(errors, label, def.url, at(node));
        break;
      }
      case 'image':
        checkImageUrl(errors, label, node.url, at(node), { gameId, readFileSize });
        break;
      case 'imageReference': {
        const def = definitions.get(node.identifier);
        if (def) checkImageUrl(errors, label, def.url, at(node), { gameId, readFileSize });
        break;
      }
      default:
        break;
    }
  });
}

function checkLinkUrl(errors, label, url, at) {
  if (/^https?:\/\//i.test(url) || url.startsWith('#')) return;
  errors.push(`${label} のリンク先 "${truncate(url)}" は使えません${at}。http:// か https:// で始まるURLにしてください。`);
}

function checkImageUrl(errors, label, url, at, { gameId, readFileSize }) {
  const invalid = (why) => errors.push(`${label} の画像 "${truncate(url)}" は使えません${at}: ${why}`);

  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) {
    invalid('外部URLの画像は使えません。画像ファイルを games/<gameId>/ に置き、相対パスで指定してください。');
    return;
  }
  if (url.startsWith('/') || url.includes('\\') || /[?#]/.test(url)) {
    invalid('guide.md からの相対パス(例: images/board.png)で指定してください。');
    return;
  }
  const segments = url.split('/');
  if (segments.some((s) => s === '..')) {
    invalid('games/<gameId>/ の外のファイルは参照できません。');
    return;
  }
  const ext = url.split('.').pop().toLowerCase();
  if (!IMAGE_EXTENSIONS.includes(ext)) {
    invalid(`使える画像形式は ${IMAGE_EXTENSIONS.join(' / ')} です。`);
    return;
  }
  if (typeof readFileSize !== 'function') return;

  const path = `games/${gameId}/${guideImagePath(url)}`;
  const size = readFileSize(path);
  if (size === null || size === undefined) {
    invalid(`${path} が見つかりません。`);
  } else if (size > GUIDE_LIMITS.maxImageBytes) {
    invalid(`ファイルが大きすぎます(${formatKb(size)})。1枚あたり${formatKb(GUIDE_LIMITS.maxImageBytes)}以下にしてください。`);
  }
}

/**
 * Normalizes a guide image URL that already passed checkImageUrl (relative, no `..`) to a path
 * relative to the game directory, e.g. "./images/a.png" -> "images/a.png".
 */
export function guideImagePath(url) {
  return url.split('/').filter((s) => s && s !== '.').join('/');
}

function visit(node, fn) {
  fn(node);
  if (Array.isArray(node.children)) {
    for (const child of node.children) visit(child, fn);
  }
}

function plainText(node) {
  if (typeof node.value === 'string') return node.value;
  return Array.isArray(node.children) ? node.children.map(plainText).join('') : '';
}

function countLines(s) {
  return s.split('\n').length;
}

function firstLine(s) {
  return String(s).split('\n')[0];
}

function truncate(s, max = 60) {
  const oneLine = String(s).replace(/\s+/g, ' ');
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

function formatKb(bytes) {
  return `${Math.round(bytes / 1024)}KB`;
}

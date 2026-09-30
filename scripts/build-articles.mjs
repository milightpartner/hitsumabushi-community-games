// Builds the game guide site (guide.milightpartner.jp, OmoshiroGamePortal#382) from
// games/<gameId>/guide.md. Pure logic only - build-articles.cli.mjs does the file I/O.
//
// Every guide merged to main is published; whether the portal links to it is decided entirely on
// the portal side (its catalog), so this build deliberately has no dependency on portal state.
//
// The article site is served under a Milight domain, so it must only ever contain HTML this
// script generates: Markdown is rendered without passing raw HTML through, and only the images a
// guide references are copied - never a game's own HTML/JS.
import matter from 'gray-matter';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toHast } from 'mdast-util-to-hast';
import { toHtml } from 'hast-util-to-html';
import { creatorDisplayName } from './creators.mjs';
import { validateGuide, guideImagePath } from './validate-guide.mjs';

export const SITE = {
  articleBaseUrl: 'https://guide.milightpartner.jp',
  portalUrl: 'https://milightpartner.jp',
  siteName: 'ひつまぶし',
  // Same site-wide auto-ads tag as the portal's index.html.
  adsenseClient: 'ca-pub-3165831236819189',
  ogImage: 'https://milightpartner.jp/logo.png',
};

/**
 * Renders guide Markdown to an HTML fragment. Raw HTML in the source is dropped (mdast-util-to-hast
 * is used without allowDangerousHtml), regardless of whether validateGuide() already rejected it.
 * @param {number} [headingShift] - added to every heading level, so a guide's own `# h1` becomes an
 *   h2 under the page's title.
 */
export function renderMarkdown(markdown, { headingShift = 0 } = {}) {
  const mdast = fromMarkdown(markdown);
  visit(mdast, (node) => {
    if (node.type === 'heading') node.depth = Math.min(6, node.depth + headingShift);
  });

  const hast = toHast(mdast);
  const usedIds = new Map();
  visit(hast, (node) => {
    if (node.type !== 'element') return;
    if (/^h[1-6]$/.test(node.tagName)) {
      // Lets the in-page links (`[..](#見出し)`) that validateGuide() allows actually resolve.
      node.properties.id = uniqueId(headingId(textContent(node)), usedIds);
    } else if (node.tagName === 'a' && /^https?:\/\//i.test(String(node.properties.href ?? ''))) {
      node.properties.target = '_blank';
      // ugc/nofollow: these are creator-written outbound links, not ones Milight vouches for.
      node.properties.rel = ['ugc', 'nofollow', 'noopener', 'noreferrer'];
    } else if (node.tagName === 'img') {
      node.properties.loading = 'lazy';
    }
  });
  return toHtml(hast);
}

/**
 * @param {object} params
 * @param {{ gameId: string, guideText: string, manifest: object | null, publishedAt?: string | null }[]} params.games -
 *   every game directory that has a guide.md. publishedAt is when guide.md was first merged
 *   (ISO 8601), or null if unknown.
 * @param {(path: string) => number | null} [params.readFileSize] - passed through to validateGuide.
 * @param {import('./creators.mjs').Creators} [params.creators] - team creators, for the author credit.
 * @param {object} [params.site] - overrides for SITE (tests).
 * @returns {{
 *   files: { path: string, content: string }[],
 *   copies: { from: string, to: string }[],
 *   articles: object[],
 *   skipped: { gameId: string, reasons: string[] }[],
 * }} files/copies paths are relative to the output directory (copies' `from` is repo-relative).
 */
export function buildArticles({ games, readFileSize, creators = {}, site: siteOverrides = {} }) {
  const site = { ...SITE, ...siteOverrides };
  const files = [];
  const copies = [{ from: 'site/article.css', to: 'article.css' }];
  const articles = [];
  const skipped = [];

  for (const { gameId, guideText, manifest, publishedAt = null } of [...games].sort((a, b) => a.gameId.localeCompare(b.gameId))) {
    // One broken guide must not take the whole site down - skip it and report.
    const errors = validateGuide({ gameId, text: guideText, readFileSize });
    if (errors.length > 0) {
      skipped.push({ gameId, reasons: errors });
      continue;
    }

    const { data, content } = matter(guideText, {});
    const url = `${site.articleBaseUrl}/${gameId}/`;
    const quickRules = typeof data.quickRules === 'string' ? data.quickRules : null;
    const article = {
      gameId,
      title: data.title.trim(),
      description: data.description.trim(),
      url,
      tags: Array.isArray(data.tags) ? data.tags.map((t) => t.trim()) : [],
      publishedAt,
      // Raw Markdown: the portal's rules panel parses ##/### sections itself. Relative image
      // paths in it resolve against assetBaseUrl.
      quickRules,
      assetBaseUrl: url,
    };

    for (const imagePath of collectImagePaths(content, quickRules)) {
      copies.push({ from: `games/${gameId}/${imagePath}`, to: `${gameId}/${imagePath}` });
    }

    files.push({
      path: `${gameId}/index.html`,
      content: renderArticlePage({
        site,
        article,
        bodyHtml: renderMarkdown(content, { headingShift: 1 }),
        gameTitle: manifest?.title ?? gameId,
        author: manifest?.creatorGithub ? creatorDisplayName(manifest.creatorGithub, creators) : null,
      }),
    });
    articles.push(article);
  }

  files.push({ path: 'index.html', content: renderIndexPage({ site, articles }) });
  files.push({ path: 'guides.json', content: `${JSON.stringify({ guides: articles }, null, 2)}\n` });
  files.push({ path: 'sitemap.xml', content: renderSitemap({ site, articles }) });
  files.push({ path: 'robots.txt', content: `User-agent: *\nAllow: /\n\nSitemap: ${site.articleBaseUrl}/sitemap.xml\n` });

  return { files, copies, articles, skipped };
}

// Mirrors the portal's article page (OmoshiroGamePortal src/pages/ArticleDetailPage.tsx) so a
// guide looks like a portal article: category badge, title, date/author, tags, a "play now"
// card before the body, and back/play buttons after it.
function renderArticlePage({ site, article, bodyHtml, gameTitle, author }) {
  const { gameId, url, title, description, tags, publishedAt } = article;
  const playUrl = `${site.portalUrl}/?create=${encodeURIComponent(gameId)}`;
  const dateStr = formatDate(publishedAt);

  const metaItems = [
    dateStr && `<span class="meta-item">${ICONS.calendar}<span>公開: ${text(dateStr)}</span></span>`,
    author && `<span class="meta-item">${ICONS.user}<span>著者: ${text(author)}</span></span>`,
  ].filter(Boolean);
  const tagChips = tags.length
    ? `<div class="article-tags-wrap">${tags.map((t) => `<span class="article-tag">#${text(t)}</span>`).join('')}</div>`
    : '';
  const articleMeta = [
    publishedAt && `<meta property="article:published_time" content="${attr(publishedAt)}">`,
    ...tags.map((t) => `<meta property="article:tag" content="${attr(t)}">`),
  ].filter(Boolean);

  return layout({
    site,
    head: `<title>${text(title)} | ${text(site.siteName)}</title>
  <meta name="description" content="${attr(description)}">
  <link rel="canonical" href="${attr(url)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="${attr(site.siteName)}">
  <meta property="og:title" content="${attr(title)}">
  <meta property="og:description" content="${attr(description)}">
  <meta property="og:url" content="${attr(url)}">
  <meta property="og:image" content="${attr(site.ogImage)}">
  ${articleMeta.join('\n  ')}
  <meta name="twitter:card" content="summary">`,
    main: `<nav class="doc-page-nav">
      <a class="btn btn-outline btn-small" href="/">${ICONS.arrowLeft}<span>記事一覧に戻る</span></a>
      <a class="btn btn-outline btn-small" href="${attr(`${site.portalUrl}/`)}">トップへ</a>
    </nav>
    <article class="article-detail-card">
      <header class="article-header">
        <div class="article-meta-tags"><span class="article-cat-badge">🎮 ゲーム解説</span></div>
        <h1 class="article-detail-title">${text(title)}</h1>
        <div class="article-meta-row">
          ${metaItems.join('\n          ')}
        </div>
        ${tagChips}
      </header>
      <div class="article-game-cta">
        <div class="cta-game">
          <div class="cta-icon">${ICONS.gamepad}</div>
          <div>
            <div class="cta-caption">この記事のゲームですぐに対戦！</div>
            <div class="cta-title">${text(gameTitle)}</div>
          </div>
        </div>
        <a class="btn btn-primary" href="${attr(playUrl)}">${ICONS.sparkles}<span>対戦部屋を作成して遊ぶ</span></a>
      </div>
      <div class="markdown-content article-markdown-body">
${bodyHtml}
      </div>
      <footer class="article-detail-footer">
        <a class="btn btn-outline" href="/">${ICONS.arrowLeft}<span>すべての解説記事を見る</span></a>
        <a class="btn btn-primary" href="${attr(playUrl)}">${ICONS.gamepad}<span>「${text(gameTitle)}」を遊ぶ</span></a>
      </footer>
    </article>`,
  });
}

function renderIndexPage({ site, articles }) {
  const items = articles.length
    ? articles
        .map((a) => {
          const dateStr = formatDate(a.publishedAt);
          const date = dateStr ? `<span class="item-date">公開: ${text(dateStr)}</span>` : '';
          return `<li><a href="/${attr(a.gameId)}/"><span class="item-title">${text(a.title)}</span><span class="item-desc">${text(a.description)}</span>${date}</a></li>`;
        })
        .join('\n      ')
    : '<li class="empty">まだ記事はありません。</li>';

  return layout({
    site,
    head: `<title>ゲーム解説記事 | ${text(site.siteName)}</title>
  <meta name="description" content="${attr(`${site.siteName}で遊べる対戦ゲームのルール・遊び方の解説記事の一覧です。`)}">
  <link rel="canonical" href="${attr(`${site.articleBaseUrl}/`)}">`,
    main: `<h1 class="article-detail-title">ゲーム解説記事</h1>
    <ul class="article-list">
      ${items}
    </ul>`,
  });
}

/** "2026年9月30日" in JST - same format as the portal's toLocaleDateString('ja-JP', { month: 'long' }). */
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric' });
}

// lucide icons (ISC license) - the same ones the portal page renders via lucide-react.
const icon = (paths) =>
  `<svg class="icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  arrowLeft: icon('<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>'),
  calendar: icon('<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>'),
  user: icon('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  gamepad: icon('<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>'),
  sparkles: icon('<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>'),
};

function layout({ site, head, main }) {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${head}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800;900&family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap">
  <link rel="stylesheet" href="/article.css">
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${attr(site.adsenseClient)}" crossorigin="anonymous"></script>
</head>
<body>
  <header class="site-header">
    <a class="logo" href="${attr(`${site.portalUrl}/`)}">${text(site.siteName)}</a>  </header>
  <main class="page">
    ${main}
  </main>
  <footer class="site-footer">
    <a href="${attr(`${site.portalUrl}/`)}">${text(site.siteName)}で遊ぶ</a>
  </footer>
</body>
</html>
`;
}

function renderSitemap({ site, articles }) {
  const urls = [`${site.articleBaseUrl}/`, ...articles.map((a) => a.url)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${text(u)}</loc></url>`).join('\n')}
</urlset>
`;
}

/** Relative image paths referenced from the article body and quickRules (already validated). */
function collectImagePaths(...markdowns) {
  const paths = new Set();
  for (const md of markdowns) {
    if (!md) continue;
    const tree = fromMarkdown(md);
    const definitions = new Map();
    visit(tree, (node) => {
      if (node.type === 'definition') definitions.set(node.identifier, node.url);
    });
    visit(tree, (node) => {
      const url = node.type === 'image' ? node.url : node.type === 'imageReference' ? definitions.get(node.identifier) : null;
      if (url) paths.add(guideImagePath(url));
    });
  }
  return [...paths];
}

function headingId(s) {
  return s.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '') || 'section';
}

function uniqueId(base, used) {
  const n = used.get(base) ?? 0;
  used.set(base, n + 1);
  return n === 0 ? base : `${base}-${n}`;
}

function textContent(node) {
  if (node.type === 'text') return node.value;
  return Array.isArray(node.children) ? node.children.map(textContent).join('') : '';
}

function visit(node, fn) {
  fn(node);
  if (Array.isArray(node.children)) {
    for (const child of node.children) visit(child, fn);
  }
}

function text(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function attr(s) {
  return text(s).replace(/"/g, '&quot;');
}

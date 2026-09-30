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
 * @param {{ gameId: string, guideText: string, manifest: object | null }[]} params.games - every
 *   game directory that has a guide.md.
 * @param {(path: string) => number | null} [params.readFileSize] - passed through to validateGuide.
 * @param {object} [params.site] - overrides for SITE (tests).
 * @returns {{
 *   files: { path: string, content: string }[],
 *   copies: { from: string, to: string }[],
 *   articles: object[],
 *   skipped: { gameId: string, reasons: string[] }[],
 * }} files/copies paths are relative to the output directory (copies' `from` is repo-relative).
 */
export function buildArticles({ games, readFileSize, site: siteOverrides = {} }) {
  const site = { ...SITE, ...siteOverrides };
  const files = [];
  const copies = [{ from: 'site/article.css', to: 'article.css' }];
  const articles = [];
  const skipped = [];

  for (const { gameId, guideText, manifest } of [...games].sort((a, b) => a.gameId.localeCompare(b.gameId))) {
    // One broken guide must not take the whole site down - skip it and report.
    const errors = validateGuide({ gameId, text: guideText, readFileSize });
    if (errors.length > 0) {
      skipped.push({ gameId, reasons: errors });
      continue;
    }

    const { data, content } = matter(guideText, {});
    const url = `${site.articleBaseUrl}/${gameId}/`;
    const quickRules = typeof data.quickRules === 'string' ? data.quickRules : null;

    for (const imagePath of collectImagePaths(content, quickRules)) {
      copies.push({ from: `games/${gameId}/${imagePath}`, to: `${gameId}/${imagePath}` });
    }

    files.push({
      path: `${gameId}/index.html`,
      content: renderArticlePage({
        site,
        gameId,
        url,
        title: data.title.trim(),
        description: data.description.trim(),
        bodyHtml: renderMarkdown(content, { headingShift: 1 }),
        gameTitle: manifest?.title ?? gameId,
        creatorGithub: manifest?.creatorGithub ?? null,
      }),
    });

    articles.push({
      gameId,
      title: data.title.trim(),
      description: data.description.trim(),
      url,
      // Raw Markdown: the portal's rules panel parses ##/### sections itself. Relative image
      // paths in it resolve against assetBaseUrl.
      quickRules,
      assetBaseUrl: url,
    });
  }

  files.push({ path: 'index.html', content: renderIndexPage({ site, articles }) });
  files.push({ path: 'guides.json', content: `${JSON.stringify({ guides: articles }, null, 2)}\n` });
  files.push({ path: 'sitemap.xml', content: renderSitemap({ site, articles }) });
  files.push({ path: 'robots.txt', content: `User-agent: *\nAllow: /\n\nSitemap: ${site.articleBaseUrl}/sitemap.xml\n` });

  return { files, copies, articles, skipped };
}

function renderArticlePage({ site, gameId, url, title, description, bodyHtml, gameTitle, creatorGithub }) {
  const playUrl = `${site.portalUrl}/?create=${encodeURIComponent(gameId)}`;
  const cta = `<a class="cta" href="${attr(playUrl)}">${text(gameTitle)}で今すぐ対戦する</a>`;
  const credit = creatorGithub
    ? `<p class="credit">作者: <a href="https://github.com/${attr(encodeURIComponent(creatorGithub))}" rel="noopener noreferrer" target="_blank">${text(creatorGithub)}</a></p>`
    : '';

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
  <meta name="twitter:card" content="summary">`,
    main: `<nav class="breadcrumb"><a href="/">解説記事</a> / ${text(gameTitle)}</nav>
    <h1>${text(title)}</h1>
    <p class="lead">${text(description)}</p>
    <article class="article-body">
${bodyHtml}
    </article>
    ${cta}
    ${credit}`,
  });
}

function renderIndexPage({ site, articles }) {
  const items = articles.length
    ? articles
        .map(
          (a) => `<li><a href="/${attr(a.gameId)}/"><span class="item-title">${text(a.title)}</span><span class="item-desc">${text(a.description)}</span></a></li>`,
        )
        .join('\n      ')
    : '<li class="empty">まだ記事はありません。</li>';

  return layout({
    site,
    head: `<title>ゲーム解説記事 | ${text(site.siteName)}</title>
  <meta name="description" content="${attr(`${site.siteName}で遊べる対戦ゲームのルール・遊び方の解説記事の一覧です。`)}">
  <link rel="canonical" href="${attr(`${site.articleBaseUrl}/`)}">`,
    main: `<h1>ゲーム解説記事</h1>
    <ul class="article-list">
      ${items}
    </ul>`,
  });
}

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
    <a class="logo" href="${attr(`${site.portalUrl}/`)}">${text(site.siteName)}</a>
    <a class="header-link" href="/">解説記事</a>
  </header>
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

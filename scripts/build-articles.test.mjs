import { describe, it, expect } from 'vitest';
import { buildArticles, renderMarkdown } from './build-articles.mjs';

const guideText = (body = '# 遊び方\n\n本文です。\n', extraFrontmatter = '') =>
  `---\ngameId: my-game\ntitle: マイゲームの遊び方\ndescription: マイゲームのルールです。\n${extraFrontmatter}---\n\n${body}`;

const manifest = { gameId: 'my-game', title: 'マイゲーム', creatorGithub: 'alice' };

const build = ({ games, readFileSize = () => 1000 } = {}) =>
  buildArticles({ games: games ?? [{ gameId: 'my-game', guideText: guideText(), manifest }], readFileSize });

const file = (result, path) => result.files.find((f) => f.path === path)?.content;

describe('renderMarkdown', () => {
  it('drops raw HTML even if it reached the renderer', () => {
    const html = renderMarkdown('テキスト\n\n<script>alert(1)</script>\n\n<b>太字</b>\n');
    expect(html).not.toMatch(/<script|<b>/);
    expect(html).toContain('テキスト');
  });

  it('shifts heading levels and gives headings ids for in-page links', () => {
    const html = renderMarkdown('# 遊び方\n\n## 上達 の コツ\n\n## 上達 の コツ\n', { headingShift: 1 });
    expect(html).toContain('<h2 id="遊び方">');
    expect(html).toContain('<h3 id="上達-の-コツ">');
    expect(html).toContain('<h3 id="上達-の-コツ-1">');
  });

  it('marks outbound links as user-generated and opens them in a new tab', () => {
    const html = renderMarkdown('[公式](https://example.com) [上へ](#遊び方)\n');
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="ugc nofollow noopener noreferrer">');
    // the fragment is percent-encoded; browsers decode it when matching the heading id
    expect(html).toContain(`<a href="#${encodeURIComponent('遊び方')}">`);
  });
});

describe('buildArticles', () => {
  it('builds the guide page, index, guides.json, sitemap and robots.txt', () => {
    const result = build();
    expect(result.articles).toHaveLength(1);
    expect(result.skipped).toEqual([]);

    const page = file(result, 'my-game/index.html');
    expect(page).toContain('<title>マイゲームの遊び方 | ひつまぶし</title>');
    expect(page).toContain('<link rel="canonical" href="https://guide.milightpartner.jp/my-game/">');
    expect(page).toContain('href="https://milightpartner.jp/?create=my-game"');
    expect(page).toContain('adsbygoogle.js?client=ca-pub-');
    expect(page).toContain('https://github.com/alice');

    expect(file(result, 'index.html')).toContain('href="/my-game/"');
    expect(file(result, 'sitemap.xml')).toContain('<loc>https://guide.milightpartner.jp/my-game/</loc>');
    expect(file(result, 'robots.txt')).toContain('Sitemap: https://guide.milightpartner.jp/sitemap.xml');

    const json = JSON.parse(file(result, 'guides.json'));
    expect(json.guides[0]).toMatchObject({
      gameId: 'my-game',
      title: 'マイゲームの遊び方',
      url: 'https://guide.milightpartner.jp/my-game/',
      quickRules: null,
    });
  });

  it('skips an invalid guide but still builds the others', () => {
    const result = build({
      games: [
        { gameId: 'my-game', guideText: guideText(), manifest },
        { gameId: 'bad-game', guideText: guideText('<script>x</script>\n'), manifest: null },
      ],
    });
    expect(result.articles.map((a) => a.gameId)).toEqual(['my-game']);
    expect(result.skipped.map((s) => s.gameId)).toEqual(['bad-game']);
  });

  it('copies only the images a guide references - never the game itself', () => {
    const body = '![盤面](./images/board.png)\n\n![b][pic]\n\n[pic]: images/b.webp\n';
    const result = build({ games: [{ gameId: 'my-game', guideText: guideText(body), manifest }] });
    expect(result.copies).toEqual([
      { from: 'site/article.css', to: 'article.css' },
      { from: 'games/my-game/images/board.png', to: 'my-game/images/board.png' },
      { from: 'games/my-game/images/b.webp', to: 'my-game/images/b.webp' },
    ]);
  });

  it('escapes creator-controlled text in the page', () => {
    const result = build({
      games: [{ gameId: 'my-game', guideText: guideText(), manifest: { ...manifest, title: '<img src=x onerror=alert(1)>' } }],
    });
    const page = file(result, 'my-game/index.html');
    expect(page).not.toContain('<img src=x');
    expect(page).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('passes quickRules through as raw Markdown for the portal rules panel', () => {
    const quickRules = 'quickRules: |\n  ## 勝利条件\n  3つ揃えたら勝ち。\n';
    const result = build({ games: [{ gameId: 'my-game', guideText: guideText(undefined, quickRules), manifest }] });
    expect(result.articles[0].quickRules).toBe('## 勝利条件\n3つ揃えたら勝ち。\n');
  });
});

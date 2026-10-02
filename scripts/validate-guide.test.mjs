import { describe, it, expect } from 'vitest';
import { validateGuide, GUIDE_LIMITS } from './validate-guide.mjs';

// The body gets an H1 (the article title) matching the frontmatter title, unless the test
// supplies its own H1.
const guide = ({ frontmatter, body = '本文です。\n' } = {}) => {
  const fm = frontmatter ?? [
    'gameId: my-game',
    'title: マイゲームの遊び方',
    'description: マイゲームのルールを紹介します。',
    'quickRules: |',
    '  ## 勝利条件',
    '  3つ揃えたら勝ち。',
    '',
    '  ### 詳しいルール',
    '  - 交互に置く。',
  ].join('\n');
  const heading = /^# /m.test(body) ? '' : `# ${fm.match(/^title: (.+)$/m)?.[1] ?? '遊び方'}\n\n`;
  return `---\n${fm}\n---\n\n${heading}${body}`;
};

const run = (text, readFileSize) => validateGuide({ gameId: 'my-game', text, readFileSize });

describe('validateGuide', () => {
  it('accepts a valid guide', () => {
    expect(run(guide())).toEqual([]);
  });

  it('accepts the starter template shape, including its HTML comment', () => {
    const body = '<!--\n  この guide.md は任意です。\n-->\n\n# マイゲームの遊び方\n\n## マイゲームとは\n\n説明。\n';
    expect(run(guide({ body }))).toEqual([]);
  });

  it('accepts a guide without quickRules', () => {
    const frontmatter = 'gameId: my-game\ntitle: 遊び方\ndescription: 説明です。';
    expect(run(guide({ frontmatter }))).toEqual([]);
  });

  describe('frontmatter', () => {
    it('rejects a guide with no frontmatter', () => {
      const errors = run('# 遊び方\n\n本文\n');
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/frontmatter/);
    });

    it('rejects malformed YAML', () => {
      const errors = run(guide({ frontmatter: 'gameId: my-game\ntitle: [unclosed' }));
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/YAMLとして読み込めません/);
    });

    it('rejects a gameId that does not match the directory', () => {
      const frontmatter = 'gameId: other-game\ntitle: 遊び方\ndescription: 説明です。';
      expect(run(guide({ frontmatter })).some((e) => e.includes('"other-game"'))).toBe(true);
    });

    it('requires description (title is optional: the article title comes from the H1)', () => {
      const errors = run(guide({ frontmatter: 'gameId: my-game' }));
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/description が必須/);
    });

    it('rejects an overlong description', () => {
      const long = 'あ'.repeat(GUIDE_LIMITS.maxDescriptionLength + 1);
      const frontmatter = `gameId: my-game\ntitle: 遊び方\ndescription: ${long}`;
      expect(run(guide({ frontmatter })).some((e) => e.includes('description が長すぎます'))).toBe(true);
    });

    it('rejects reserved keys with a reason (slug hijack / author impersonation)', () => {
      const frontmatter = [
        'gameId: my-game',
        'title: 遊び方',
        'description: 説明です。',
        'slug: neon-tic-tac-toe-guide',
        'author: ひつまぶし公式',
      ].join('\n');
      const errors = run(guide({ frontmatter }));
      expect(errors.some((e) => e.includes('slug は指定できません') && e.includes('ゲームIDから自動で決まります'))).toBe(true);
      expect(errors.some((e) => e.includes('author は指定できません') && e.includes('creatorGithub'))).toBe(true);
    });

    it('accepts tags within the limits', () => {
      const frontmatter = 'gameId: my-game\ntitle: 遊び方\ndescription: 説明です。\ntags: ["攻略", "2人対戦"]';
      expect(run(guide({ frontmatter }))).toEqual([]);
    });

    it('rejects malformed, too many and overlong tags', () => {
      const base = 'gameId: my-game\ntitle: 遊び方\ndescription: 説明です。\n';
      expect(run(guide({ frontmatter: `${base}tags: 攻略` })).some((e) => e.includes('文字列のリスト'))).toBe(true);
      const many = JSON.stringify(Array.from({ length: GUIDE_LIMITS.maxTags + 1 }, (_, i) => `t${i}`));
      expect(run(guide({ frontmatter: `${base}tags: ${many}` })).some((e) => e.includes('個までです'))).toBe(true);
      const long = 'あ'.repeat(GUIDE_LIMITS.maxTagLength + 1);
      expect(run(guide({ frontmatter: `${base}tags: ["${long}"]` })).some((e) => e.includes('が長すぎます'))).toBe(true);
    });

    it('rejects unknown keys', () => {
      const frontmatter = 'gameId: my-game\ntitle: 遊び方\ndescription: 説明です。\nfoo: bar';
      expect(run(guide({ frontmatter })).some((e) => e.includes('未対応の項目 foo'))).toBe(true);
    });
  });

  describe('title heading (H1)', () => {
    const fm = 'gameId: my-game\ndescription: 説明です。';

    it('accepts an H1 without a frontmatter title', () => {
      expect(run(guide({ frontmatter: fm, body: '# マイゲームの遊び方\n\n本文。\n' }))).toEqual([]);
    });

    it('requires an H1', () => {
      const errors = run(`---\n${fm}\n---\n\n## 遊び方\n\n本文。\n`);
      expect(errors.some((e) => e.includes('記事のタイトルになる見出し(# ...)が必要です'))).toBe(true);
    });

    it('rejects more than one H1, and an H1 that is not the first heading', () => {
      const errors = run(`---\n${fm}\n---\n\n## はじめに\n\n# タイトル\n\n# 2つ目\n`);
      expect(errors.some((e) => e.includes('1つだけにしてください'))).toBe(true);
      expect(errors.some((e) => e.includes('本文の最初の見出しにしてください'))).toBe(true);
    });

    it('rejects a frontmatter title that differs from the H1', () => {
      const errors = run(guide({ frontmatter: `${fm}\ntitle: 別のタイトル`, body: '# マイゲームの遊び方\n' }));
      expect(errors.some((e) => e.includes('一致しません'))).toBe(true);
    });

    it('rejects an overlong H1', () => {
      const errors = run(guide({ frontmatter: fm, body: `# ${'あ'.repeat(GUIDE_LIMITS.maxTitleLength + 1)}\n` }));
      expect(errors.some((e) => e.includes('タイトルの見出しが長すぎます'))).toBe(true);
    });
  });

  describe('quickRules', () => {
    it('rejects # and #### headings', () => {
      const frontmatter = [
        'gameId: my-game',
        'title: 遊び方',
        'description: 説明です。',
        'quickRules: |',
        '  # 大見出し',
        '  #### 小見出し',
      ].join('\n');
      const errors = run(guide({ frontmatter }));
      expect(errors.filter((e) => e.includes('quickRules の見出し'))).toHaveLength(2);
    });

    it('rejects a non-string quickRules', () => {
      const frontmatter = 'gameId: my-game\ntitle: 遊び方\ndescription: 説明です。\nquickRules:\n  - a';
      expect(run(guide({ frontmatter })).some((e) => e.includes('quickRules は文字列'))).toBe(true);
    });

    it('applies the HTML check inside quickRules too', () => {
      const frontmatter = [
        'gameId: my-game',
        'title: 遊び方',
        'description: 説明です。',
        'quickRules: |',
        '  ## 勝利条件',
        '  <img src=x onerror=alert(1)>',
      ].join('\n');
      expect(run(guide({ frontmatter })).some((e) => e.includes('quickRules にHTMLタグは書けません'))).toBe(true);
    });
  });

  describe('body', () => {
    it('rejects raw HTML blocks and inline tags, with a line number', () => {
      const body = '# マイゲームの遊び方\n\n<script>alert(1)</script>\n\nテキスト <b>太字</b>\n';
      const errors = run(guide({ body }));
      // the block counts once; inline <b> and </b> are separate nodes
      expect(errors.filter((e) => e.includes('HTMLタグは書けません'))).toHaveLength(3);
      // frontmatter is 11 lines (--- + 9 + ---), then a blank line, so body line 3 is file line 15
      expect(errors[0]).toMatch(/15行目/);
    });

    it('rejects a comment that hides a tag after it', () => {
      const body = '<!-- ok --><iframe src="https://evil.example"></iframe>\n';
      expect(run(guide({ body })).some((e) => e.includes('HTMLタグは書けません'))).toBe(true);
    });

    it('ignores HTML inside code blocks and inline code', () => {
      const body = '```html\n<div>例</div>\n```\n\n`<br>` は改行タグです。\n';
      expect(run(guide({ body }))).toEqual([]);
    });

    it('allows http(s) links and in-page anchors', () => {
      const body = '[公式](https://example.com) [上へ](#遊び方) <https://example.com/auto>\n';
      expect(run(guide({ body }))).toEqual([]);
    });

    it('rejects javascript:, relative and reference-style bad links', () => {
      const body = '[a](javascript:alert(1)) [b](../other) [c][ref]\n\n[ref]: data:text/html,hi\n';
      expect(run(guide({ body })).filter((e) => e.includes('リンク先'))).toHaveLength(3);
    });

    it('rejects an oversized guide.md', () => {
      const body = 'あ'.repeat(GUIDE_LIMITS.maxFileBytes / 3 + 10);
      expect(run(guide({ body })).some((e) => e.includes('大きすぎます'))).toBe(true);
    });
  });

  describe('images', () => {
    const sizes = { 'games/my-game/images/board.png': 1000, 'games/my-game/big.jpg': GUIDE_LIMITS.maxImageBytes + 1 };
    const readFileSize = (path) => sizes[path] ?? null;

    it('accepts a relative image that exists and is small enough', () => {
      expect(run(guide({ body: '![盤面](images/board.png)\n' }), readFileSize)).toEqual([]);
      expect(run(guide({ body: '![盤面](./images/board.png)\n' }), readFileSize)).toEqual([]);
    });

    it('rejects external, absolute and parent-directory images', () => {
      const body = '![a](https://example.com/a.png) ![b](/a.png) ![c](../other-game/a.png) ![d](//cdn.example/a.png)\n';
      expect(run(guide({ body }), readFileSize).filter((e) => e.includes('の画像'))).toHaveLength(4);
    });

    it('rejects disallowed formats such as svg', () => {
      expect(run(guide({ body: '![a](images/a.svg)\n' }), readFileSize).some((e) => e.includes('使える画像形式'))).toBe(true);
    });

    it('rejects missing and oversized images', () => {
      const errors = run(guide({ body: '![a](images/missing.png) ![b](big.jpg)\n' }), readFileSize);
      expect(errors.some((e) => e.includes('見つかりません'))).toBe(true);
      expect(errors.some((e) => e.includes('大きすぎます'))).toBe(true);
    });

    it('checks reference-style images', () => {
      const body = '![a][pic]\n\n[pic]: https://example.com/a.png\n';
      expect(run(guide({ body }), readFileSize).some((e) => e.includes('外部URLの画像'))).toBe(true);
    });

    it('skips existence checks when no file reader is given', () => {
      expect(run(guide({ body: '![a](images/missing.png)\n' }))).toEqual([]);
    });
  });
});

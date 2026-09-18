import { describe, it, expect } from 'vitest';
import { validatePr } from './validate-pr.mjs';

const validManifest = (overrides = {}) => ({
  gameId: 'my-game',
  title: 'マイゲーム',
  players: { min: 2, max: 2, type: 'fixed' },
  resultModel: { type: 'single_winner' },
  creatorGithub: 'alice',
  ...overrides,
});

describe('validatePr', () => {
  it('accepts a valid new-game submission', () => {
    const result = validatePr({
      changedFiles: ['games/my-game/manifest.json', 'games/my-game/index.html'],
      prAuthor: 'alice',
      readBaseManifest: () => null,
      readHeadManifest: () => validManifest(),
    });
    expect(result.ok).toBe(true);
    expect(result.gameId).toBe('my-game');
  });

  it('accepts a valid update from the original creator', () => {
    const result = validatePr({
      changedFiles: ['games/my-game/index.html'],
      prAuthor: 'alice',
      readBaseManifest: () => validManifest(),
      readHeadManifest: () => validManifest(),
    });
    expect(result.ok).toBe(true);
  });

  it('rejects files outside games/', () => {
    const result = validatePr({
      changedFiles: ['games/my-game/manifest.json', '.github/workflows/deploy.yml'],
      prAuthor: 'alice',
      readBaseManifest: () => null,
      readHeadManifest: () => validManifest(),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('.github/workflows/deploy.yml'))).toBe(true);
  });

  it('rejects a PR touching more than one game', () => {
    const result = validatePr({
      changedFiles: ['games/my-game/index.html', 'games/other-game/index.html'],
      prAuthor: 'alice',
      readBaseManifest: () => null,
      readHeadManifest: () => validManifest(),
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/1つのPRで変更できるのは1ゲームのみ/);
  });

  it('rejects a non-kebab-case game id', () => {
    const result = validatePr({
      changedFiles: ['games/My_Game/manifest.json'],
      prAuthor: 'alice',
      readBaseManifest: () => null,
      readHeadManifest: () => validManifest({ gameId: 'My_Game' }),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('kebab-case'))).toBe(true);
  });

  it('rejects when manifest.json is missing', () => {
    const result = validatePr({
      changedFiles: ['games/my-game/index.html'],
      prAuthor: 'alice',
      readBaseManifest: () => null,
      readHeadManifest: () => null,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('manifest.json'))).toBe(true);
  });

  it('rejects when gameId in manifest does not match the directory name', () => {
    const result = validatePr({
      changedFiles: ['games/my-game/manifest.json'],
      prAuthor: 'alice',
      readBaseManifest: () => null,
      readHeadManifest: () => validManifest({ gameId: 'someone-elses-slug' }),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('一致しません'))).toBe(true);
  });

  it('rejects invalid players/resultModel enums', () => {
    const result = validatePr({
      changedFiles: ['games/my-game/manifest.json'],
      prAuthor: 'alice',
      readBaseManifest: () => null,
      readHeadManifest: () => validManifest({ players: { min: 2, max: 2, type: 'weird' }, resultModel: { type: 'weird' } }),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('players.type'))).toBe(true);
    expect(result.errors.some((e) => e.includes('resultModel.type'))).toBe(true);
  });

  it('rejects a new submission missing creatorGithub', () => {
    const result = validatePr({
      changedFiles: ['games/my-game/manifest.json'],
      prAuthor: 'alice',
      readBaseManifest: () => null,
      readHeadManifest: () => {
        const m = validManifest();
        delete m.creatorGithub;
        return m;
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('creatorGithub'))).toBe(true);
  });

  it('rejects a new submission where creatorGithub does not match the PR author', () => {
    const result = validatePr({
      changedFiles: ['games/my-game/manifest.json'],
      prAuthor: 'mallory',
      readBaseManifest: () => null,
      readHeadManifest: () => validManifest({ creatorGithub: 'alice' }),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('mallory'))).toBe(true);
  });

  it('rejects someone other than the original creator editing an existing game (ownership hijack attempt)', () => {
    const result = validatePr({
      changedFiles: ['games/my-game/manifest.json'],
      prAuthor: 'mallory',
      readBaseManifest: () => validManifest({ creatorGithub: 'alice' }),
      readHeadManifest: () => validManifest({ creatorGithub: 'mallory' }),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('別のGitHubユーザー'))).toBe(true);
  });

  it('rejects reassigning creatorGithub even by the original creator', () => {
    const result = validatePr({
      changedFiles: ['games/my-game/manifest.json'],
      prAuthor: 'alice',
      readBaseManifest: () => validManifest({ creatorGithub: 'alice' }),
      readHeadManifest: () => validManifest({ creatorGithub: 'bob' }),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('後から変更できません'))).toBe(true);
  });

  it('rejects an index.html that still points at the dev-harness-only SDK path', () => {
    const result = validatePr({
      changedFiles: ['games/my-game/manifest.json', 'games/my-game/index.html'],
      prAuthor: 'alice',
      readBaseManifest: () => null,
      readHeadManifest: () => validManifest(),
      readHeadFileText: (path) =>
        path === 'games/my-game/index.html'
          ? '<script type="importmap">{"imports":{"@milightpartner/hitsumabushi-sdk":"/__hitsumabushi_dev__/sdk.js"}}</script>'
          : null,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('vendor-sdk'))).toBe(true);
  });

  it('accepts an index.html that points at a vendored relative SDK path', () => {
    const result = validatePr({
      changedFiles: ['games/my-game/manifest.json', 'games/my-game/index.html', 'games/my-game/vendor/hitsumabushi-sdk.js'],
      prAuthor: 'alice',
      readBaseManifest: () => null,
      readHeadManifest: () => validManifest(),
      readHeadFileText: (path) =>
        path === 'games/my-game/index.html'
          ? '<script type="importmap">{"imports":{"@milightpartner/hitsumabushi-sdk":"./vendor/hitsumabushi-sdk.js"}}</script>'
          : 'class HitsumabushiSDK {}',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an empty diff', () => {
    const result = validatePr({
      changedFiles: [],
      prAuthor: 'alice',
      readBaseManifest: () => null,
      readHeadManifest: () => null,
    });
    expect(result.ok).toBe(false);
  });
});

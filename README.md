# hitsumabushi-community-games

対戦ゲームポータル「**ひつまぶし (OmoshiroGamePortal)**」のコミュニティ枠ゲームを集約するリポジトリです。誰でもForkしてPRを送ることでゲームを投稿できます。手順は [CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください。

- ゲームは `games/<gameId>/` 配下に1つずつ配置されます。
- `main` へのマージで自動的に `https://hitu-mabusi-community.web.app/<gameId>/` へデプロイされます。
- PRは自動検証されます(`games/`以外への変更禁止、1PR1ゲーム、`manifest.json`のスキーマ・所有者チェック)。詳細は [`scripts/validate-pr.mjs`](./scripts/validate-pr.mjs) を参照。

## チームでの投稿 (`creators.json`)

`manifest.json` の `creatorGithub` には、通常は投稿者自身のGitHubユーザー名を書きます。代わりに [`creators.json`](./creators.json) に定義したチーム名(例: ミライト公式ゲームの `milightpartner`)を書くと、そのチームの `members` の誰でもそのゲームを投稿・更新でき、解説記事の著者は `displayName`(例: 「ひつまぶし」)で表示されます。

`creators.json` は `games/` の外にあるため、メンテナーしか変更できません(PRの検証はマージ先ブランチの `creators.json` を使います)。

## 開発

```bash
npm install
npm test              # validate-pr.mjs の単体テスト
npm run validate-pr   # 実際のPR検証をローカルで再現する場合
```

## 関連リポジトリ

- [hitsumabushi-game-starter](https://github.com/milightpartner/hitsumabushi-game-starter) — ゲーム開発用スターターテンプレート
- [OmoshiroGamePortal](https://github.com/milightpartner/OmoshiroGamePortal) — ポータル本体

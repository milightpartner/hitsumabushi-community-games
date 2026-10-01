# hitsumabushi-community-games

対戦ゲームポータル「**ひつまぶし (OmoshiroGamePortal)**」のコミュニティ枠ゲームを集約するリポジトリです。誰でもForkしてPRを送ることでゲームを投稿できます。手順は [CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください。

- ゲームは `games/<gameId>/` 配下に1つずつ配置されます。
- `main` へのマージで自動的に `https://hitu-mabusi-community.web.app/<gameId>/` へデプロイされます。
- PRは自動検証されます(`games/`以外への変更禁止、1PR1ゲーム、`manifest.json`のスキーマ・所有者チェック)。詳細は [`scripts/validate-pr.mjs`](./scripts/validate-pr.mjs) を参照。

## チームでの投稿 (`creators.json`)

`manifest.json` の `creatorGithub` には、通常は投稿者自身のGitHubユーザー名を書きます。代わりに [`creators.json`](./creators.json) に定義したチーム名(例: ミライト公式ゲームの `milightpartner`)を書くと、そのチームの `members` の誰でもそのゲームを投稿・更新でき、解説記事の著者は `displayName`(例: 「ひつまぶし」)で表示されます。

`creators.json` は `games/` の外にあるため、メンテナーしか変更できません(PRの検証はマージ先ブランチの `creators.json` を使います)。

## メンテナー向け: `games/` 以外の変更(インフラ変更)

PRの検証(`Validate PR`)の「`games/<gameId>/` 配下だけ変更可・1PR1ゲーム」というルールは、外部からの投稿を安全に受け付けるためのもので、このリポジトリは提出専用という位置づけです。

`scripts/` / `.github/workflows/` / `package.json` / ドキュメントなど、`games/` 以外を変更するインフラ変更は、**PR作成者がこのリポジトリのメンバー**(GitHubの `author_association` が `OWNER` / `MEMBER` / `COLLABORATOR`)であれば、上記のルールを適用せずに検証します。代わりに、リポジトリ内の**全ゲーム**の `manifest.json` と `guide.md` が検査に通ることを確認します(インフラ変更で既存のゲームを壊していないかの確認)。

- 管理者でないメンバーも、通常のPRフローでインフラ変更をマージできます
- `author_association` はGitHubが設定する値なので、外部の人が偽ることはできません
- メンバーでも、ゲームだけを変更するPRは通常どおり(外部と同じ)のルールで検証されます

## 開発

```bash
npm install
npm test              # validate-pr.mjs の単体テスト
npm run validate-pr   # 実際のPR検証をローカルで再現する場合
```

## 関連リポジトリ

- [Hitsumabushi SDK のドキュメント](https://milightpartner.jp/creator) — ゲームの作り方(`hitsumabushi init` でゲーム一式を用意できます)
- [OmoshiroGamePortal](https://github.com/milightpartner/OmoshiroGamePortal) — ポータル本体

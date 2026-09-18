# ゲームを投稿する

このリポジトリは、対戦ゲームポータル「**ひつまぶし (OmoshiroGamePortal)**」の**コミュニティ枠**にゲームを投稿するための共有リポジトリです。誰でもForkしてPRを送ることで投稿できます。

## 1. ゲームを作る

[`hitsumabushi-game-starter`](https://github.com/milightpartner/hitsumabushi-game-starter) を「Use this template」で使い、AIエディタと対話しながらゲームを実装してください。手元での動作確認は `npm run dev` (`hitsumabushi dev`) でできます。

## 2. このリポジトリにForkでPRを送る

1. このリポジトリをFork
2. `games/<あなたのゲームID>/` ディレクトリを作り、ゲームのファイル一式(`index.html`、`manifest.json`、必要なら画像・音声アセット)を配置
3. `manifest.json` に `creatorGithub` フィールドを追加し、**あなたのGitHubユーザー名**を設定する(例: `"creatorGithub": "your-github-username"`)
4. PRを送る

## 3. 守ってほしいルール(CIが自動チェックします)

- **1つのPRで変更してよいのは自分の `games/<gameId>/` 配下だけ**です。他のディレクトリやリポジトリ直下の設定ファイルを変更するPRは弾かれます。
- **1つのPRで扱えるのは1ゲームのみ**です。複数ゲームをまとめて追加/更新するPRは分けて送ってください。
- ゲームID(ディレクトリ名)は半角英数小文字とハイフンのみ(`kebab-case`)。
- `manifest.json` は [ゲームマニフェスト仕様書](https://github.com/milightpartner/OmoshiroGamePortal/blob/main/packages/hitsumabushi-sdk/docs/game-manifest-spec.md) に準拠している必要があります。
- **一度設定した `creatorGithub` は変更できません**。他人が作ったゲームのディレクトリを、別のGitHubアカウントから変更することはできません(なりすまし防止)。
- **SDKは公開URLの `<script>` タグで読み込んでください**(推奨・標準の書き方です)。

  ```html
  <script src="https://milightpartner.jp/sdk/hitsumabushi-sdk.js"></script>
  <script>
    Hitsumabushi.init({ /* ... */ });
  </script>
  ```

  `index.html`のimport mapが`/__hitsumabushi_dev__/sdk.js`を指したままではいけません。これは`npx hitsumabushi dev`(ローカル開発ハーネス)専用のパスで、本番では404になりゲームが一切反応しなくなります。SDKの実体をリポジトリにコピーする(vendoring)運用も採っていません。`hitsumabushi-game-starter`をそのまま使っていれば、通常は意識する必要はありません。

これらを満たさないPRは、CIチェック(`Validate PR`)が失敗し、マージできません。

## 4. マージされたら

`main` へのマージ後、自動的に Firebase Hosting (`https://hitu-mabusi-community.web.app/<gameId>/`) へデプロイされます。ただし、これは**「コミュニティ枠のサイトに公開される」ところまでで、OmoshiroGamePortal本体のゲームカタログへの掲載は別工程(運営によるテストプレイ審査)です**。掲載を希望する場合は、マージ後に `milightpartner/OmoshiroGamePortal` の管理者へ連絡してください。

## 5. 同一リポジトリ内ブランチからのPRの場合

書き込み権限を持つコラボレーターがこのリポジトリ内のブランチから直接PRを送った場合、Firebase Preview Channelが自動発行され、PRコメントにプレビューURLが投稿されます。**Forkからの投稿の場合はセキュリティ上の理由からPreview Channelは発行されません**(`npm run dev` でのローカル確認を使ってください)。CIの検証自体はFork/非Forkに関わらず同じように動作します。

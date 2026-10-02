# ゲームを投稿する

このリポジトリは、対戦ゲームポータル「**ひつまぶし (OmoshiroGamePortal)**」の**コミュニティ枠**にゲームを投稿するための共有リポジトリです。誰でもForkしてPRを送ることで投稿できます。

## 1. ゲームを作る

ゲームは**自分のリポジトリ**で開発します(このリポジトリは提出専用です)。新しいリポジトリで Hitsumabushi SDK の `init` を実行すると、ゲーム一式が用意されます。

```bash
npx -p @milightpartner/hitsumabushi-sdk hitsumabushi init
```

`games/<gameId>/` にゲーム本体(`index.html`)・`manifest.json`・解説記事(`guide.md`)の雛形・テストが、`.claude/skills/` にAI開発用のスキルが作られます。Claude Code でリポジトリを開いてゲームのルールを伝えれば実装が進みます。手元での動作確認は `npm run dev`、ポータルの要件を満たしているかの検査は `npm run verify` でできます。SDKのインストールに必要な設定は [インストールガイド](https://milightpartner.jp/creator/installation) を参照してください。

## 2. このリポジトリにForkでPRを送る

1. このリポジトリをFork
2. 自分のリポジトリの `games/<あなたのゲームID>/` を、ディレクトリごとそのままコピーする(`index.html`、`manifest.json`、`guide.md`、必要なら画像・音声アセット)
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

  `index.html`のimport mapが`/__hitsumabushi_dev__/sdk.js`を指したままではいけません。これは`npx hitsumabushi dev`(ローカル開発ハーネス)専用のパスで、本番では404になりゲームが一切反応しなくなります。SDKの実体をリポジトリにコピーする(vendoring)運用も採っていません。`hitsumabushi init` が作るテンプレートをそのまま使っていれば、通常は意識する必要はありません。

### 解説記事 (`guide.md`)

`games/<gameId>/guide.md` は**必須**です(ゲームのルールを伝えるもので、ルールの無いゲームは公開しません)。`hitsumabushi init` が作る雛形を元に書いてください。ゲームの解説記事として公開され、`quickRules` はゲーム画面のルールパネルに表示されます。記事はミライトのドメインで公開されるため、次のルールをCIがチェックします。

- **本文の最初の見出し(`# ...`)が記事のタイトルになります。** 本文に `#` の見出しを1つだけ、最初の見出しとして書いてください(60文字以内)。2つ目以降の見出しは `##` 以下にします。
- 先頭の `---` で囲まれた部分(frontmatter)に書けるのは `gameId` / `title` / `description` / `quickRules` / `tags` だけです。
  - `description`(120文字以内)は必須です。`quickRules` と `tags` は任意です。
  - `gameId` は任意です(ゲームIDはディレクトリ名で決まります)。書く場合はディレクトリ名と同じにしてください。
  - `title` は任意です。書く場合は本文の `#` の見出しと同じにしてください(食い違うとCIが止めます)。
  - `slug` / `author` / `category` / `publishedAt` などは指定できません。記事のURLはゲームIDから自動で決まります(`https://guide.milightpartner.jp/<gameId>/`)。
  - `tags` は任意です(例: `tags: ["攻略", "2人対戦"]`、10個まで・1つ20文字以内)。
- `quickRules` の見出しは `##`(常に表示)と `###`(タップで開閉)だけが使えます。
- 本文と `quickRules` に**HTMLタグは書けません**(`<!-- -->` のコメントは可)。Markdownの記法だけを使ってください。コードブロック内のタグは問題ありません。
- リンクは `http://` か `https://` で始まるURL、またはページ内リンク(`#見出し`)のみです。
- 画像は `games/<gameId>/` 内に置き、`guide.md` からの相対パスで指定してください(例: `![盤面](images/board.png)`)。形式は png / jpg / jpeg / gif / webp、1枚500KBまでです。外部URLの画像は使えません。
- `guide.md` 自体は50KBまでです。

これらを満たさないPRは、CIチェック(`Validate PR`)が失敗し、マージできません。`guide.md` はそのPRで変更していなくても、ゲームに関するPRでは毎回チェックされます(無い場合もエラーになります)。

## 4. マージされたら

`main` へのマージ後、自動的に Firebase Hosting (`https://hitu-mabusi-community.web.app/<gameId>/`) へデプロイされます。ただし、これは**「コミュニティ枠のサイトに公開される」ところまでで、OmoshiroGamePortal本体のゲームカタログへの掲載は別工程(運営によるテストプレイ審査)です**。掲載を希望する場合は、マージ後に `milightpartner/OmoshiroGamePortal` の管理者へ連絡してください。

## 5. 同一リポジトリ内ブランチからのPRの場合

書き込み権限を持つコラボレーターがこのリポジトリ内のブランチから直接PRを送った場合、Firebase Preview Channelが自動発行され、PRコメントにプレビューURLが投稿されます。**Forkからの投稿の場合はセキュリティ上の理由からPreview Channelは発行されません**(`npm run dev` でのローカル確認を使ってください)。CIの検証自体はFork/非Forkに関わらず同じように動作します。

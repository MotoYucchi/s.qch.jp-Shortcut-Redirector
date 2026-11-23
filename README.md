# s.qch.jp Shortcut Redirector

`s.qch.jp` 用のオリジナル静的ショートカットリダイレクタシステムと、MotoYucchi 専用ローカル GUI 管理ツールです。

## 構成

- `links.json` — ショートカット定義（スラッグ・遷移先URL・タイトル・説明・トップページ公開設定）
- `build.js` — `links.json` と `src/` から静的サイト（`dist/`）を生成するビルドスクリプト
- `src/home.html` — `s.qch.jp` トップページテンプレート（公開ショートカット一覧を自動生成）
- `src/404.html` — 404 エラーページ
- `src/pages/` — 静的ページ（そのまま `/pages/...` として配信）
- `tools/manager.js` / `tools/manager.html` — ローカル PC 向け GUI 管理ツール（公開物 `dist/` には含まれません）
- `.github/workflows/static.yml` — `main` への push で自動ビルド＆GitHub Pages デプロイ

## ビルド方法

```bash
npm run build
```

## MotoYucchi 専用 GUI 管理ツールの使い方（PC 環境向け）

`git` と `Node.js` が入った PC 環境であれば、外部パッケージのインストール不要（依存ゼロ）ですぐに起動できます。

### 起動方法

- **Windows**: `start-manager.bat` をダブルクリック
- **macOS / Linux**: `start-manager.command` をダブルクリック（または `./start-manager.command`）
- **コマンドライン**:
  ```bash
  npm run admin
  ```

起動すると自動的にブラウザで管理画面（`http://127.0.0.1:4173`）が開きます。

### 主な機能

- **ショートカットの追加・編集・削除**: スラッグ重複チェック、指定桁数のランダム英数字スラッグ自動生成、URL 検証、トップページ掲載の公開/非公開トグル
- **Pages エクスプローラー (`src/pages`)**: HTML・画像・サンプルファイルの追加／ドラッグ＆ドロップアップロード／名前変更／移動／削除、フォルダ作成・移動・削除、ローカルリアルタイムプレビュー
- **内蔵コードエディタ（依存ゼロ）**: HTML / CSS / JS / JSON のシンタックスハイライト、インデント空白・タブの色分け（Indent Rainbow）、リアルタイム構文チェック（閉じタグ忘れ・括弧抜け・JS/CSS 構文エラー・重複 ID 検出）
- **ビルドテスト**: ローカルで `build.js` を実行して生成結果を確認
- **Git Sync & Deploy（ワンクリック反映）**:
  - **Sync & Deploy**: `links.json` と `src/pages` の変更を `git add` → `git commit` → `git pull --rebase` → `git push` で一括反映
  - **個別操作**: `Pull` / `Commit` / `Push` / `links.json 変更破棄`
  - **確認機能**: `links.json` の Diff 表示、実行ログコンソール、最近のコミット履歴表示

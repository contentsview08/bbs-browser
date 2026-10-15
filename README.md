# bbs-browser

コネクタで掲示板を読む、PC 向けの専用ブラウザ(Tauri v2)。
2ch 互換(5ch、eddist、hono-bbs など)は標準コネクタの一つで、別形式の掲示板はコネクタを足して対応する。

## 構成

```
packages/connectors/   コネクタ(純 TS。Tauri にも DOM にも依存しない)
  src/types.ts         Connector / ConnectorContext の定義
  src/twoch/           2ch 互換コネクタ(bbsmenu / subject.txt / dat、差分取得つき)
packages/logstore/     ログの保存(SQLite)。既読位置・Cursor・レス・板一覧のキャッシュ
  migrations/          スキーマ。Rust のマイグレーションと vitest の両方がこのファイルを読む
apps/desktop/          Tauri アプリ(React + Vite + Tailwind。見た目は hono-bbs の web 版から移植)
  src/host/            ConnectorContext と LogStore の Tauri 版(plugin-http / plugin-sql)
  src-tauri/           Rust 側。公式プラグインの登録とマイグレーションだけ
```

コネクタは `fetch` を直接呼ばず、ホストから渡される `ctx.http` / `ctx.decode` だけを使う。
ログの DB は `%APPDATA%\io.github.yumekui8.bbs-browser\bbs-browser.db`。

## 開発環境(Windows)

Rust と Node はユーザー領域に入れ、版はリポジトリで固定する(`rust-toolchain.toml` / `mise.toml`)。
システム全体に入るのは MSVC(Build Tools)だけ。PowerShell で一度だけ、この順に入れる。

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install --id Rustlang.Rustup
winget install --id jdx.mise
```

mise の shims をユーザーの PATH に足す(一度だけ。足したらターミナルを開き直す)。

```powershell
[Environment]::SetEnvironmentVariable('Path', "$env:LOCALAPPDATA\mise\shims;" + [Environment]::GetEnvironmentVariable('Path', 'User'), 'User')
```

WebView2 は Windows 10/11 に最初から入っている。

## 起動

```powershell
mise trust       # 初回だけ。このリポジトリの mise.toml を信頼する
mise install     # Node を入れる
npm install
npm run dev      # 初回は Rust のビルドで数分かかる
```

## そのほか

```powershell
npm test         # コネクタのテスト
npm run typecheck
npm run build    # インストーラー(MSI / NSIS)を作る
```

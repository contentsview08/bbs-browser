# bbs-browser

コネクタで掲示板を読む、PC 向けの専用ブラウザ(Tauri v2)。
2ch 互換(5ch、eddist、hono-bbs など)は標準コネクタの一つで、別形式の掲示板はコネクタを足して対応する。

## 構成

```
packages/connectors/   コネクタ(純 TS。Tauri にも DOM にも依存しない)
  src/types.ts         Connector / ConnectorContext の定義
  src/twoch/           2ch 互換コネクタ(bbsmenu / subject.txt / dat、差分取得つき)
apps/desktop/          Tauri アプリ(React + Vite)
  src/host/            ConnectorContext の Tauri 版(plugin-http で通信)
  src-tauri/           Rust 側。いまは公式プラグインの登録だけ
```

コネクタは `fetch` を直接呼ばず、ホストから渡される `ctx.http` / `ctx.decode` だけを使う。

## 開発環境(Windows)

PowerShell で一度だけ入れる。

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install --id Rustlang.Rustup
winget install --id OpenJS.NodeJS.LTS
winget install --id Git.Git
```

WebView2 は Windows 10/11 に最初から入っている。

## 起動

```powershell
npm install
npm run dev      # 初回は Rust のビルドで数分かかる
```

## そのほか

```powershell
npm test         # コネクタのテスト
npm run typecheck
npm run build    # インストーラー(MSI / NSIS)を作る
```

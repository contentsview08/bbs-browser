# bbs-browser

コネクタで掲示板を読む、PC 向けの専用ブラウザ(Tauri v2)。
掲示板の形式ごとの違いはコネクタで吸収する。いまのコネクタは次の 3 つ。

| コネクタ | 対象 | できること |
|---|---|---|
| 2ch 互換 | 5ch、eddist、hono-bbs など | 読む(差分取得・過去ログ)、書き込み、スレ立て、BE ログイン |
| したらば | jbbs.shitaraba.net | 読む、書き込み、スレ立て |
| ふたば☆ちゃんねる | *.2chan.net | 読む(カタログ・サムネイル)、「>文章」の引用元へのリンク、そうだね。書き込み・画像の添付・スレ立て・削除は作ってあるが、画像の添付・スレ立て・削除・そうだねを押すことは本番で確かめていない |

板は URL 欄に板(またはスレ)の URL を入れて開き、お気に入りに足す。5ch は板一覧(bbsmenu)からも選べる。

## 使い方の要点

- **キー操作は vim 風**(Vimium 寄せ)。`?` でキーの一覧、`Ctrl+K` か `:` でコマンドパレット(板・スレ・操作を名前で探す)。
  - `J` `K` `↑` `↓` でレス(スレ一覧ではスレ)を選び、`Enter` で開く。`G G` で先頭、`Shift+G` で末尾、`D` `U` で半画面。
  - `Ctrl+E` でスレ一覧とスレ表示の、キーを受け取る方を入れ替える(受け取っている方の上に線が出る)。
  - `Shift+U` で未読の巡回(未読のあるタブ・お気に入りのスレへ順に移る)。`Shift+E` で選んでいるレスに返信(本文を選んでいれば引用)。
  - 割り当ては 設定 → キー操作 で変えられる。
- **見た目**は、配色(ライト・ダーク・Discord ダーク・LINE ライト・真っ黒 など)と、レスの見た目(カード・Discord 風・専ブラ風・LINE 風)、表示の密度(一覧表示・高密度)を組み合わせる。スタイルメニューか設定の「表示」から。
- **画面の分け方**は、2 画面(スレ一覧とスレ表示を並べる)・1 画面(スレ表示がスレ一覧の上に重なる)・自動(ウィンドウの形で切り替える)。
- 画像は catbox にアップロードして本文に URL を入れる。ふたばは書き込みにファイルを付ける。
- NG(名前・ID・本文・スレタイ)、お気に入りのスレの新着の通知、キーワードに合う新スレの通知、スレの保存(HTML・テキスト)、設定と DB のバックアップがある。

## 構成

```
packages/connectors/   コネクタ(純 TS。Tauri にも DOM にも依存しない)
  src/types.ts         Connector / ConnectorContext の定義
  src/twoch/           2ch 互換(bbsmenu / subject.txt / dat、差分取得、過去ログ、書き込み、BE)
  src/shitaraba/       したらば(subject.txt / rawmode.cgi、EUC-JP)
  src/futaba/          ふたば(カタログ / スレのページ / JSON、書き込み)
packages/logstore/     ログの保存(SQLite)。既読位置・Cursor・レス・板一覧・お気に入り・書き込み履歴など
  migrations/          スキーマ。Rust のマイグレーションと vitest の両方がこのファイルを読む
apps/desktop/          Tauri アプリ(React + Vite + Tailwind。見た目は hono-bbs の web 版から移植して広げた)
  src/host/            ConnectorContext と LogStore の Tauri 版(plugin-http / plugin-sql)
  src/utils/           判断の部分を関数に分けたもの(スクロール・選び方・画面の状態・本文の解析など。test/ でテスト)
  src-tauri/           Rust 側。公式プラグインの登録、書き込みの通信(post_http.rs)、選んだパスだけの読み書き(chosen_paths.rs)
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
npm test         # コネクタ・logstore・desktop のテスト(vitest)
npm run typecheck
npm run build    # インストーラー(MSI / NSIS)を作る
```

本番の掲示板への試し書き込みはテストでは行わない(偽サーバーで確かめる)。

# CLAUDE.md

日本語で応答する。コメントも日本語。

## 概要

PC 向けの掲示板専用ブラウザ(Tauri v2 + React)。Windows が最優先、Linux は次点。
掲示板の形式ごとの違いは「コネクタ」で吸収する。2ch 互換コネクタは標準コネクタの一つにすぎない。

- `packages/connectors` — コネクタ。純 TS で、Tauri・DOM・グローバルの `fetch` に依存させない。
  通信と文字コード変換はホストが渡す `ConnectorContext` 経由で行う(テストで偽サーバーを差し込めるように、
  また将来の外部コネクタをサンドボックスに入れられるように)。
- `packages/logstore` — ログの保存。SQL は `SqlDb` 越しに実行し、アプリでは tauri-plugin-sql、テストでは sql.js を使う。
  tauri-plugin-sql は接続プールなのでトランザクションに頼らない。途中で落ちても次の取得で直る順番で書く
  (reset は cursor を先に NULL に、updated はレスを書いてから cursor を進める)。
  スキーマを変えるときは `migrations/` に新しい番号のファイルを足し、`src-tauri/src/lib.rs` にも登録する。
- `apps/desktop` — Tauri アプリ。`src/host/tauriContext.ts` が `ConnectorContext` の実装。
  Rust 側は公式プラグインの登録だけにとどめ、必要になるまで独自の Rust コードは書かない。

## 設計の決まりごと

- 差分取得の続き(`Cursor`)の中身はコネクタだけが解釈する。ホストは JSON として保存して渡し返すだけ。
- UI はコネクタの `capabilities` を見て機能を出し分ける。
- 本文はコネクタの段階でプレーンテキストにする。UI で `innerHTML` / `dangerouslySetInnerHTML` を使わない。
- 2ch 互換の User-Agent は `Monazilla/1.00 (bbs-browser/x.y.z)`。
- 見た目は hono-bbs の web 版(`~/git/koizumib/hono-bbs-merge/packages/web`)から移植している。
  `apps/desktop/src/theme/*.css` と `src/index.css` は web 版の複製なので、中身を勝手に変えない。
  色は `c-*` の Tailwind クラス(CSS 変数)だけを使い、固定色や `slate-*` を新しく書かない。
  表示設定は `<html>` の `data-scheme` / `data-pattern` / `data-density` で切り替わる(`src/ui/settings.ts`)。
- フォントは npm パッケージで同梱する(Google Fonts は使わない。通信なしでも同じ見た目にするため)。

## 開発環境

普段の開発は Windows ネイティブ(WebView2 で確認する)。Node は mise(`mise.toml`)、Rust は rustup(`rust-toolchain.toml`)で版を固定している。WSL から作業するときは、`/mnt/c/...` に
Linux 用の node_modules を作らないこと(Windows 側で `npm install` し直しになる)。

```
npm install
npm run dev        # tauri dev
npm test           # コネクタのテスト(vitest)
npm run typecheck
```

## 今後

1. 書き込み(2ch 互換は bbs.cgi。5ch は Cookie・認証の仕様が変わりやすいので要確認)
2. アカウント: BE・UPLIFT・どんぐりなど、サイトごとのログイン。ログイン機構(hono-bbs のアカウント)は作らない。
   Cookie は plugin-http の cookies 機能(有効化済み)で持つ。パスワードなどの資格情報は settings 表に入れず、
   OS の資格情報ストア(Windows 資格情報マネージャー等)に置く
3. web 版から残りを移植(ミニマップ、OGP のリンクプレビュー)
4. 2 つ目のコネクタ(hono-bbs ネイティブ API、したらばなど)

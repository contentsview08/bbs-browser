# CLAUDE.md

日本語で応答する。コメントも日本語。

## 概要

PC 向けの掲示板専用ブラウザ(Tauri v2 + React)。Windows が最優先、Linux は次点。
掲示板の形式ごとの違いは「コネクタ」で吸収する。2ch 互換コネクタは標準コネクタの一つにすぎない。

- `packages/connectors` — コネクタ。純 TS で、Tauri・DOM・グローバルの `fetch` に依存させない。
  通信と文字コード変換はホストが渡す `ConnectorContext` 経由で行う(テストで偽サーバーを差し込めるように、
  また将来の外部コネクタをサンドボックスに入れられるように)。
- `apps/desktop` — Tauri アプリ。`src/host/tauriContext.ts` が `ConnectorContext` の実装。
  Rust 側は公式プラグインの登録だけにとどめ、必要になるまで独自の Rust コードは書かない。

## 設計の決まりごと

- 差分取得の続き(`Cursor`)の中身はコネクタだけが解釈する。ホストは JSON として保存して渡し返すだけ。
- UI はコネクタの `capabilities` を見て機能を出し分ける。
- 本文はコネクタの段階でプレーンテキストにする。UI で `innerHTML` / `dangerouslySetInnerHTML` を使わない。
- 2ch 互換の User-Agent は `Monazilla/1.00 (bbs-browser/x.y.z)`。

## 開発環境

普段の開発は Windows ネイティブ(WebView2 で確認する)。WSL から作業するときは、`/mnt/c/...` に
Linux 用の node_modules を作らないこと(Windows 側で `npm install` し直しになる)。

```
npm install
npm run dev        # tauri dev
npm test           # コネクタのテスト(vitest)
npm run typecheck
```

## 今後

1. ログの保存(plugin-sql で SQLite。既読位置・Cursor・レス)
2. hono-bbs の web(`~/git/koizumib/hono-bbs-merge/packages/web`)のデザインを移植
3. 書き込み(2ch 互換は bbs.cgi。5ch は Cookie・認証の仕様が変わりやすいので要確認)
4. 2 つ目のコネクタ(hono-bbs ネイティブ API、したらばなど)

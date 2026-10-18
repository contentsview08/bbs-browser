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
  Rust 側は公式プラグインの登録が中心。WebView でできないこと(OS のフォント一覧など)だけ、`src-tauri/src/lib.rs` に小さな命令として書く。

## 設計の決まりごと

- 差分取得の続き(`Cursor`)の中身はコネクタだけが解釈する。ホストは JSON として保存して渡し返すだけ。
- UI はコネクタの `capabilities` を見て機能を出し分ける。
- 本文はコネクタの段階でプレーンテキストにする。UI で `innerHTML` / `dangerouslySetInnerHTML` を使わない。
- 2ch 互換の User-Agent は `Monazilla/1.00 (bbs-browser/x.y.z)`。
- 書き込みは `POST /test/bbs.cgi`(Shift_JIS の URL エンコード。`packages/connectors/src/sjis.ts`)。
  eddist(eddibb)は初回に認証コードを返し、ブラウザで `/auth-code` を済ませると `edge-token` Cookie で通るようになる。
  書き込み(と BE などのログイン)の POST は、plugin-http ではなく自前の通信(`src-tauri/src/post_http.rs` の `http_post`)で送る。
  Cookie もそこが持ち、app_data_dir の `post-cookies.json` に毎回保存する。書き込みごとに Cookie を外せるようにするため
  (BE を使わない書き込みでは DMDM・MDMD を外す)。plugin-http の Cookie 置き場はアプリから中身を触れず、
  Cookie ヘッダーを手で付けると置き場の Cookie が付かなくなる(reqwest の決まり)ので使えない。読む通信(GET)は plugin-http のまま。
  本番の板への試し書き込みはしない。応答の解析は eddist のソースにある文面をテストに写して確かめる。
- ふたばは書き込みの送り方がほかと違う(`packages/connectors/src/futaba/connector.ts` の先頭に詳しく書いた)。
  ふたばの書き込みボタンの JavaScript(`/bin/base4esc.js` の `ptfk`)と同じにしないと、受け付けられるのに誰にも見えない書き込みになる:
  multipart/form-data・UTF-8(`chrenc=文字`)、`pthc` に `/bin/cachemt7.php` の値・`pthb` は初回空、`ptua` は Chromium の値、
  `responsemode=ajax`(返事は ok か JSON)、ブラウザの User-Agent、Cookie は読む通信と同じ置き場(`sameCookiesAsGet` で plugin-http から POST)。
  2026-10-17 のテスト中に回線ごと「アクセス規制中」になったので、ふたばへリクエストを送る開発は止めている(再開はユーザーと相談)。
- 見た目は hono-bbs の web 版(`~/git/koizumib/hono-bbs-merge/packages/web`)から移植している。
  `apps/desktop/src/theme/*.css` と `src/index.css` は web 版の複製なので、中身を勝手に変えない。
  色は `c-*` の Tailwind クラス(CSS 変数)だけを使い、固定色や `slate-*` を新しく書かない。
  表示設定は `<html>` の `data-scheme` / `data-pattern` / `data-density` / `data-post-style` で切り替わる(`src/ui/settings.ts`)。
  `data-pattern`(トーナル・枠線)はレスの見た目(`postStyle`: カード・Discord 風・専ブラ風・LINE 風)から決める。
  意味の色は役目ごとの変数を使う(未読 `--c-unread`、自分 `--c-own`、失敗 `--c-error`、選んでいる印 `--c-cursor-tint`、差し色 `--c-mark-*`)。
- フォントは npm パッケージで同梱する(Google Fonts は使わない。通信なしでも同じ見た目にするため)。
- スレ表示のスクロール(開いたときの位置・既読・新着の追いかけ)は `src/hooks/useThreadScroll.ts` にまとめ、
  どこへ動かすか・どこまで読んだかの判断は `src/utils/threadScroll.ts` の関数に分けてテストする(`apps/desktop/test/`)。
  画面の外のレスは content-visibility で省いているので、仮の高さ(覚えておいた高さか本文からの見積もり)を style で渡す。
- 残しておくタブのスレ表示は、並び順を変えない(要素が付け替えられるとスクロール位置が一番上に戻る)。
- 選んでいるタブ・1 画面でスレ一覧を出しているか・戻る/進むの履歴は、`src/utils/viewState.ts` の関数でいっしょに変える(別々に書き換えるとずれる)。
- J・K などで選ぶレス・スレの決め方は `src/utils/cursor.ts`(スレ表示・スレ一覧・ポップアップで共通、テストあり)。
- キー操作は `src/utils/keymap.ts` の操作の表(`KeyAction`)に割り当てる。ジェスチャーなどを足すときも、この表に割り当てる。
- 外付けのコネクタ(MOD): `%APPDATA%/…/connectors/<フォルダ>/{manifest.json,connector.js}` を Rust(`connector_files.rs`)が読むだけ、本体は `src/host/connectorSandbox.ts` の QuickJS(WebAssembly)の囲いで動かす(window・fetch・Tauri なし、通信は manifest の hosts だけ。テストあり)。許可は設定の `connectors`。書き方は `docs/connectors.md`、見本は `examples/connectors/sample-offline`(テストで読み込んでいる)。レスへの反応・操作・印は `Connector.reactions/postActions`・`Badge` で一般化してある(ふたばのそうだねもこの形)。
- 自動 NG(荒らしの判定)は `src/utils/autoNg.ts`(決まりの境目は手でラベルを付けた 340 件で合わせた。テストあり)。ユーザーの印は DB の `troll_marks`(migration 014)に本文ごと貯め、印から育つ判定は `src/utils/trollModel.ts`(判断軸 = でたらめ度・スレをまたいだ重複(長文はコピペ、短文はスラング)・繰り返し・URL・長さ + 文字の 1〜3 文字の並び → ロジスティック回帰。コーパスは DB のログ、荒らしの印 3 件から使う)。Laya の特徴を足すのは次の段。
- レスを描く数が多いと重い。1 レスの要素を増やさない(操作バーはマウスを乗せたときだけ作る、ID アイコンは背景の絵 1 つ)。
  スレ表示とスレ一覧は、見える所から先に作り、残りは手の空いたときに作り足す。
- 他のサービスに迷惑をかけない: 自動の取得(自動更新・お気に入りのスレの確認・キーワードの見張り)は、アプリが見えていないときと、
  dat 落ち・1000 到達のスレでは行わない。手での更新・書き込みにはクールダウンがある。条件なしの GET は 3 秒、
  裏の処理のスレ一覧は 60 秒使い回す(`host/tauriContext.ts`、`hooks/useWatchLists.ts`)。
- レスに書かれた URL は、家の中のネットワーク・自分の PC のアドレス(`utils/safeUrl.ts`)なら、表示しただけでは読みに行かない
  (サムネイル・動画・リンクのプレビュー・画像一覧・ビューアー)。押したときだけ開く。
- ファイルの読み書きは、Rust 側で出したダイアログで本人が選んだパスだけ(`src-tauri/src/chosen_paths.rs`)。
  画面から好きなパスを渡して読み書き・削除できる命令を作らない。CSP は `tauri.conf.json`(開発用は `devCsp`)。
- App.tsx に何でも足さない。まとまりのある処理は `hooks/` に分ける(通知・アカウント・キーワードの見張りなど)。

## 開発環境

普段の開発は Windows ネイティブ(WebView2 で確認する)。Node は mise(`mise.toml`)、Rust は rustup(`rust-toolchain.toml`)で版を固定している。WSL から作業するときは、`/mnt/c/...` に
Linux 用の node_modules を作らないこと(Windows 側で `npm install` し直しになる)。

```
npm install
npm run dev        # tauri dev
npm test           # コネクタ・logstore・desktop のテスト(vitest)
npm run typecheck
```

## 今後

1. アカウント: BE は作った(コネクタの accounts / login。書き込み欄の sage の右の ︙ で、書き込みごとに使うか選べる)。
   パスワードは accounts 表にそのまま置く(Linux に資格情報ストアがあるとは限らないため)。UPLIFT・どんぐりは保留
2. 実機で BE のログインを確かめる(成功の見分けは「ログイン画面がまた出たか」だけで、本物のアカウントでは試していない)
3. 自動 NG(連投・コピペ)は保留。判断用の軽量 LLM を内蔵する案と合わせて考える
4. 2 つ目のコネクタ(hono-bbs ネイティブ API、したらばなど)
5. 配布(インストーラー・自動更新)

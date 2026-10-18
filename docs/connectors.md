# 外付けのコネクタの書き方

自分で作った掲示板(や、まだ対応していない掲示板)を、アプリをビルドし直さずに読めるようにする仕組みです。
コネクタをフォルダに置き、アプリの 設定 → コネクタ で有効にします(マインクラフトの MOD のような使い方)。

## 置き場所

```
%APPDATA%\io.github.yumekui8.bbs-browser\connectors\
  my-bbs\
    manifest.json   … 名前・版・通信する先
    connector.js    … 本体
```

設定 → コネクタ の「フォルダを開く」で、この場所を開けます。置いたら「読み込み直す」を押し、「有効にする」を押します。
有効にするとき、manifest.json の `hosts`(通信する先)を確かめる画面が出ます。あとで `hosts` を変えると、確かめ直すまで使えません。

動く見本が `examples/connectors/sample-offline/` にあります(通信しないので、そのままコピーして試せます。URL 欄に
`https://sample.bbs-browser.invalid/board/` を入れると開きます)。

## manifest.json

```json
{
  "id": "my-bbs",
  "name": "自作の掲示板",
  "version": "1.0.0",
  "api": 1,
  "hosts": ["bbs.example.com", "*.cdn.example.com"],
  "description": "設定の画面に出す説明(なくてもよい)",
  "author": "作った人(なくてもよい)"
}
```

| 項目 | 中身 |
|---|---|
| `id` | 英小文字・数字・`-`(2〜41 文字)。組み込みのコネクタの名前(`2ch-compat`・`shitaraba`・`futaba`・`demo`)は使えない |
| `api` | コネクタの決まりの版。いまは `1` |
| `hosts` | 通信してよい先のホスト名。`*.example.com` は `example.com` とその下の全部。コネクタが受け持つ URL も、この中のものだけ |

## connector.js

`defineConnector({ ... })` を 1 回呼びます。中身は、アプリに組み込みのコネクタと同じ形です
(決まりは `packages/connectors/src/types.ts` の `Connector`。組み込みの `twoch`・`futaba`・`shitaraba`・`demo` が実例)。

```js
const API = 'https://bbs.example.com/api'
const json = (res, ctx) => JSON.parse(ctx.decode(res.body, 'utf-8'))

defineConnector({
  capabilities: { post: true, images: false, incremental: true },

  // その場で答えるもの(Promise を返さない)
  canHandle: (url) => url.startsWith('https://bbs.example.com/'),
  isThreadUrl: (url) => /\/t\/\d+$/.test(url),
  threadWebUrl: (t) => 'https://bbs.example.com/t/' + t.key,

  // 通信するもの(ctx はアプリが渡す。引数の位置も組み込みと同じ)
  async resolveUrl(url, ctx) { /* 板(とスレ)を返す。扱えなければ null */ },
  async listBoards(site, ctx) { return [] },
  async listThreads(board, ctx, opts) {
    const res = await ctx.http.get(API + '/threads')
    return json(res, ctx).map((t, order) => ({
      connectorId: 'my-bbs', boardUrl: board.url, key: String(t.id), title: t.title,
      postCount: t.count, order, createdAt: new Date(t.created * 1000),
    }))
  },
  async fetchPosts(thread, cursor, ctx) {
    const res = await ctx.http.get(API + '/threads/' + thread.key + '/posts?after=' + (cursor ? cursor.last : 0))
    const posts = json(res, ctx).map((p) => ({ no: p.no, name: p.name, mail: '', date: p.date, body: p.body }))
    return { status: 'updated', posts, cursor: { last: posts.length ? posts[posts.length - 1].no : 0 } }
  },
  async createPost(thread, input, ctx) { /* 書き込む。{ status: 'ok', message } か { status: 'error', message } */ },
})
```

### なくてはならないもの

`canHandle`・`threadWebUrl`・`resolveUrl`・`listBoards`・`listThreads`・`fetchPosts`

### あれば使われるもの(宣言で、アプリの共通の部品が出る)

| 宣言・関数 | アプリでの見え方 |
|---|---|
| `createPost`・`createThread` | 書き込み欄・スレ立て |
| `reactions` + `react` + `fetchPosts` の `reactions` | レスの「いいね×3」などの反応(何種類でも) |
| `postActions` + `runPostAction` | レスの「その他」のメニューの操作(通報など。`confirm` があれば確かめてから) |
| `Post.badges`・`ThreadSummary.badges` | レスの名前の横・スレタイの前の印(「管理人」「固定」など) |
| `ThreadSummary.thumb` | スレ一覧のサムネイル |
| `serverSorts` | スレ一覧の並べ替えを、サーバーに頼む |
| `maxPosts` | レスの上限(ここまで来たら「満」) |
| `anchorTarget`・`Post.ref`・`textQuotes` | アンカーの指す番号、引用の書き方 |
| `attachments` | 書き込みにファイルを付けられる |
| `deletePost` | 自分の書き込みの削除 |

### レスの番号(`no`)の約束

`no` はスレの中で、レスが**届いた順の通し番号**(1 から、すき間なく)です。一度付けた番号は変えず、新しいレスにはいつも
それまでより大きい番号を付けます。既読・未読・新着の数は、全部この番号で数えます。
掲示板の本当のレス番号が別にあるときは、`ref` に入れます。

### 囲い(サンドボックス)について

`connector.js` は、アプリの中ではなく、外と切り離した囲い(QuickJS を WebAssembly で動かしたもの)の中で動きます。

- `window`・`document`・`fetch`・`XMLHttpRequest`・Node の機能はありません。アプリのログ・設定・パスワードにも触れません
- 通信は `ctx.http.get(url, { headers })`・`ctx.http.post(url, body, { headers })` だけ。`hosts` にない先へは届きません
  (返事は `{ status, headers, body }`。`body` はバイト列なので、`ctx.decode(body, 'utf-8' | 'shift_jis' | 'euc-jp')` で文字にします)
- 使えるもの: JavaScript の標準(`JSON`・`Promise`・`Date`・`RegExp`・`Map` など)、`URL`・`URLSearchParams`・`TextEncoder`・`TextDecoder`
  (簡易版)、`console.log`(開発者ツールのコンソールに `[コネクタ id]` 付きで出る)
- 1 回の処理(待ち時間を除く)は 5 秒、メモリは 64MB まで。超えると打ち切ります
- 返す値は JSON にできるものにします(関数や循環した参照は返せない)。`createdAt` は `Date` のままで構いません

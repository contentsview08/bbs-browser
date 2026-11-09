# OBB の同期を Google ドライブへ移す 設計

2026-11-09 時点。PC(`packages/sync/src/engine/drive.ts`・`apps/desktop/src-tauri/src/google_auth.rs`)とスマホ(`obb/sync/engine/DriveRemote.kt`)の Drive の置き場、偽の Drive、PC の Google のログイン、obb2 の参加は実装済み。本物の Google での確かめ(段階 D3 以降)はまだ。いまの設計は `docs/sync-design.md`(全体)・`docs/sync-client.md`(端末)・`docs/sync-security.md`(サーバーの安全)。
この文書は「置き場を自前の同期サーバーから、利用者の Google ドライブのアプリ専用フォルダ(appDataFolder)へ替える」ことだけを書く。
暗号・マージ・HLC・既読・アダプター・同期の表・きっかけ(タイミング)は今のまま使う。

## 0. 決まっていること(本人の決定)

| 項目 | 決定 |
| --- | --- |
| 認証 | OBB として登録した OAuth クライアントで「Google でログイン」。範囲は `https://www.googleapis.com/auth/drive.appdata` だけ |
| ログインする端末 | **PC だけで 1 回。** 受け取った更新用のトークン(refresh token)を、鍵 `K` と一緒に QR で他の端末へ配る |
| スマホ | Google のログインをしない。QR で受け取ったトークンと、PC と同じ「デスクトップ アプリ」のクライアント ID(とシークレット)でアクセストークンを更新し、appDataFolder を読み書きする |
| Google Cloud のクライアント | 「デスクトップ アプリ」の 1 つだけ。Android 用のクライアントと署名の SHA-1 は要らない |
| 最初の 1 台 | PC に限る(スマホだけで始める形は今は作らない。将来の案は 5 章の最後) |
| 置き場 | appDataFolder。フォルダ ID の設定は要らない |
| 中身 | 今と同じく `K` で暗号化。Google にも読めない |
| 2 台目 | 今と同じ QR(コピー用のコード)で `K` を渡す。トークンも同じ QR に入るので、同じ Google アカウントになる |
| 今のサーバー | Google のクライアントの入った版は Drive だけを使い、サーバーで使っていた端末は同期をやめた状態に戻す(7.1)。クライアントの入っていない版はサーバーのまま動く。サーバーは後で消す(7.4) |
| Google アカウントを使わない人 | 同期なし |
| 回数 | API を呼ぶ回数を抑える(変わったかの確認は 1 回、書くのはまとめて 1 ファイル) |

## 1. サーバーの役目の置き換え表

いまのエンジン(`packages/sync/src/engine/engine.ts`・`transport.ts`・`controller.ts`、Kotlin は `obb/sync/engine/SyncEngine.kt`・`SyncTransport.kt`・`SyncController.kt`)がサーバーに頼っていることを、1 つずつ Drive で何に代えるかを決める。

前提: **Drive は「書き手ごとのファイルの置き場」で、採番も比較も消去の判断もしない。** マージは可換・結合的・冪等(`docs/sync-design.md` の「マージ」)なので、全部のファイルを全部の端末がどの順で読んでも同じ状態に収束する。サーバーの一貫性の仕掛けの多くは、そのまま要らなくなる。

| いまサーバーがすること | 使っている所 | Drive では | 理由 |
| --- | --- | --- | --- |
| `version` の採番(領域で単調増加) | `/changes?since`・`settlePush`・`pushedRun`・`sync_records.version` | **要らない。** 端末の中だけの番号にする(7 章「差し替え口」)。`version > 0` は「Drive で見た・Drive へ送った」の印として残す | 収束はマージが保証する。`planRebase` は「同期済み(version > 0)なのに全件にない → 消す」に使うので、印としての意味だけ要る |
| `since` のページング(500 件・1MB) | `pull`・`readFull` | `changes.list` の `pageToken`(3 章)と、読んだファイルの `version` の控え | Drive の変更の一覧が「どこまで読んだか」の続きを持つ |
| `base_version` と 409 の CAS | `pushAll`・`settlePush` | **要らない。** 端末は自分のファイルにしか書かないので、書き込みがぶつからない。他の端末の値は読むときにマージする | 409 のあとの「マージして再送」は、全端末が全ファイルをマージすれば同じ結果になる。送り直さなくてよい |
| `request_id` で二重の採番を防ぐ | `push_inflight` | **要らない**(採番がない)。同じ内容を 2 回書いても、自分のファイルを上書きするだけ。`push_inflight` は「どのレコードを送ったか」の控えとして残す | 書き込みは冪等 |
| `epoch`(領域が作り直された) | `checkEpoch`・`SpaceGone`・`planRecreate` | 領域の目印のファイル(`space` ファイル)の `e`(2 章)。目印が消えた・変わった = 作り直し | 利用者が Drive の設定で「隠しアプリデータを削除」すると全部消える。今の「領域が消えたとき」と同じ流れにする |
| `gc_floor`(tombstone を片づけた所) | `NeedsRebase`・`planRebase` | まとめ直し(2 章)で古い tombstone を落とした時刻を、スナップショットの `g` に書く。自分が最後に読み終えた時刻より新しい `g` を見たらリベース | 意味は同じ。「片づけの後に知らない削除があったかもしれない」 |
| tombstone の 90 日後の片づけ | サーバーの alarm | 書き手の端末が、自分のスナップショットを作り直すときに落とす。古いファイルに生きた値を残さないよう、60 日で書き直す。止まった書き手のファイルに古い生きた値があれば落とさない(2.6) | 片づけるのは自分のファイルだけ。他人のファイルに触らない |
| 404(領域がない)→ 作り直し | `onSpaceGone`・`createSpace` | 目印のファイルがない → 自分で作る(作成の許可証は要らない) | 置き場は利用者のもの。作成の制限が要らない |
| 容量・クォータ(10MB・50,000 件)と 413 | `trimForQuota` | 利用者の Drive の容量。超えたら `403 storageQuotaExceeded`(413 に写す)。**古い閲覧履歴は外さず**、送るのを 1 時間待つ(`quotaWaitMs`)。画面には容量の案内(`drive_quota`)だけ出す | 上限はアプリでなく Google が決める。利用者のほかのファイルで埋まっていることが多く、OBB のレコードを外しても空かない。外すと周のたびに 500 件ずつ同期から消えていく。OBB の側では件数の上限を設けない(1 ファイルの大きさだけ決める) |
| 許可証・Turnstile・PoW | `start`・`createSpace`・`pow.ts` | **要らない** | 領域の作成で他人の費用を使わない。乱用の相手は Google のアカウントと Google の上限 |
| 枠・押し出し・放置削除・台帳・作成元・管理 API・非常スイッチ | サーバーだけ | **要らない** | 1 人の置き場が 1 人の Drive の中にある |
| `auth_token`(Bearer) | `SyncApi` | Google のアクセストークン(1 時間)。更新用のトークンから作る(5 章) | 置き場の鍵は Google が持つ |
| `space_id = SHA-256(auth_token)` | AAD・許可証 | **残す。** AAD の形を変えないため。Drive のファイルの `s` にも使う(6 章) | 暗号の共通テスト(`sync-crypto.json`)をそのまま使える |
| `pace`(サーバーからの間隔の指示) | `SyncScheduler` | **なくなる。** 端末の既定の間隔(`config.ts`・`SyncConfig.kt`)だけになる | Drive は指示を返さない。遠くから絞る口はなくなる |
| 429 と `retry_after_sec` | `waitFor` | `403 userRateLimitExceeded`・`403 rateLimitExceeded`・`403 dailyLimitExceeded`・`403 sharingRateLimitExceeded`・`429` を今の 429 と同じに扱う。指示の秒はないので、今の `backoffDelayMs`(1〜60 秒)と `RETRY_WAIT_MAX_MS` | 公式は切り詰めた指数バックオフ(最大 32〜64 秒)を勧める([上限][limits]・[エラー][errors]) |
| 401 | `block('auth_failed')` | アクセストークンを 1 回更新して送り直す。更新が断られたら(`invalid_grant` などの 4xx。429 を除く)`blocked`(`google_auth_failed`。5 章)。`403 insufficientPermissions`(範囲が足りない)も待っても直らないので同じく止める | 公式の勧め: 401 は更新、だめなら OAuth の流れへ([エラー][errors]) |
| `/head` の ETag と 304 | `checkHead` | `changes.getStartPageToken` を前置きの確認にし、変わったときだけ `changes.list`(3 章) | 回数の単位が 5 と 100 で違う(4 章) |
| `since=0` の 1 時間 3 回の制限 | サーバー | 端末の側のリベースの回数の制限(1 日 3 回)はそのまま。サーバーの制限はなくなる | |
| 同期をやめる・領域の削除(`DELETE /space`) | `leave` | やめる: 手元の鍵とトークンを消すだけ。領域の削除: その領域のファイルを全部消す | |
| サーバーの URL・`server-url.json` | `checkServerUrl`・QR | Drive の置き場では使わない(置き場の種類が「サーバー」の間だけ残す) | |

## 2. 置き方と名前

### 2.1 基本の形: 書き手ごとのファイル

- **端末は自分のファイルにしか書かない・消さない。** 他の端末のファイルは読むだけ。書き込みがぶつからない
- 1 つの領域(`space_id`)に、端末ごとに「セグメント」(最近の変更)と「スナップショット」(まとめ直した全部)を置く
- ほかに領域の目印のファイルを 1 つ置く

| 種類 | 中身 | 書き方 | 数 |
| --- | --- | --- | --- |
| 目印 `space` | 領域の `epoch`。中身は空 | 最初の端末(または作り直した端末)が作る | 領域に 1 つ |
| セグメント `seg` | この端末がこのセグメントの間に送ったレコードの最新の値(同じレコードは 1 件にまとめる) | **送るたびに同じファイルを上書きする**(`files.update`。1 回の送信 = 1 回の書き込み) | 端末ごとに開いているもの 1 つ + 閉じたもの数個 |
| スナップショット `snap` | この端末が今までに送ったレコードの最新の値。期限切れの tombstone を落とす | まとめ直しのときに新しく作る(`files.create`)。古いものは作り終えてから消す | 端末ごとに 1 世代(作り直しの間だけ 2 世代)。大きければ部分に分ける |

セグメントを閉じて次のセグメントを開く条件は、大きさが 512KB を超えそうなとき、または UTC の日が変わったとき。

### 2.2 フォルダの階層か、`name` と `appProperties` か

| 方式 | 得失 |
| --- | --- |
| appDataFolder の中にフォルダを作る(`<space>/<device>/`) | 公式の文書は「appDataFolder の中のファイルとフォルダは共有できない」と書くので、フォルダは置けるとみられるが、作り方の例がない(**未確認**)。フォルダの作成とフォルダの ID の控えで呼び出しが増える。`changes.list` は階層をたどらずに全部を返すので、読む側の得がない |
| **平らに置き、`name` と `appProperties` で表す(採用)** | 作るのも読むのも 1 回。`changes.list` と `files.list` の応答に `appProperties` を載せられるので、ファイルを開かずに誰の何かが分かる |

`appProperties` はそのアプリだけが読める私用の値で、1 ファイルに 30 個まで、1 つは鍵と値を合わせて UTF-8 で 124 バイトまで([プロパティ][props])。

| 鍵 | 値 | 例 |
| --- | --- | --- |
| `f` | 形の版 | `1` |
| `s` | `space_id`(64 桁の小文字の 16 進。鍵と合わせて 65 バイト) | |
| `t` | `space`・`seg`・`snap` | |
| `d` | 書いた端末の `device_id`(22 文字) | |
| `n` | セグメントの通番(端末ごとに 1 から) | `17` |
| `u` | スナップショットが含むセグメントの最後の通番 | `16` |
| `uv` | スナップショットが含む最後のセグメント(通番 `u`)の、閉じたときの Drive の `version`。読む側が「そのセグメントを最後の版まで読んだか」を決める(2.5) | `9` |
| `g` | スナップショットで tombstone を落とした基準の時刻(ms。これより前に tombstone になったものを落とした) | |
| `p` | スナップショットの部分 `<番号>/<数>` | `2/3` |
| `e` | 目印の `epoch`(22 文字のランダム) | |

名前は人と道具のためだけに付け、読み分けには使わない。

```
obbsync1.<space_id の先頭 16 桁>.space
obbsync1.<space_id の先頭 16 桁>.<device_id>.seg.<通番>
obbsync1.<space_id の先頭 16 桁>.<device_id>.snap.<u>.<部分>of<数>
```

スナップショットの中身の見出しは `"type": "snap"` と `u`・`uv`・`g`・`p`(セグメントの `n` の代わり)。どれも `appProperties` と同じ値で、違えば 2.3 と同じく捨てる。

### 2.3 中身の形

ファイルの中身は UTF-8 の JSON。PC の `sync_http` と スマホの OkHttp は文字列の本文を扱うので、そのまま使える。

```json
{
  "obbsync": 1,
  "space": "<space_id>",
  "device": "<device_id>",
  "type": "seg",
  "n": 17,
  "records": [
    { "record_id": "…", "kind_tag": "h", "schema_version": 1, "nonce": "…", "ciphertext": "…" }
  ]
}
```

- 各レコードは**今の `sealPayload` で作り、今の `openRecords` で開く。** AAD は今と同じ `space_id|record_id|kind_tag|schema_version`。暗号・埋め草・16KB の上限も同じ。`sync-crypto.json` をそのまま使う
- `version` と `deleted`(平文)は入れない。`version` は読む端末が付ける(7 章)。`deleted` はサーバーの片づけのためだけにあったもので、Drive では書き手が自分で片づけるので要らない(削除の事実が Google に見えなくなる)
- 見出しの `space`・`device`・`type`・`n` は `appProperties` と同じ値。違えばそのファイルを捨てて `bad_counts.drive_mismatch` に数える
- ファイル全体には別の暗号をかけない。レコードごとの AEAD で中身と `record_id` の結び付きは守られ、古い暗号文の再送は HLC で負ける(今の脅威モデルと同じ)。ファイルの入れ替え・隠しは今の「サーバーが更新を隠す」と同じく守らない

### 2.4 1 ファイルの大きさ

| 種類 | 上限 | 理由 |
| --- | --- | --- |
| セグメント | 512KB(超えそうなら閉じて次へ) | 上書きのたびに古い版(リビジョン)が残る。バイナリのファイルの古い版はふつう 30 日残り、100 版を超えると早めに消える([リビジョン][revisions])。古い版が利用者の容量に数えられるかは公式に書いていない(**未確認**)。小さく保って、残る量を抑える |
| スナップショットの 1 部分 | 4MB | 本文とメタデータを 1 回で送る `multipart` は 5MB 以下のファイル向け([アップロード][uploads])。それより大きいものを `resumable` で送ると呼び出しが増える |
| 読み取りの上限 | 1 回 5MB(`MAX_DRIVE_FILE_BYTES`) | 今の `MAX_RESPONSE_BYTES` 2MB は `/changes` のページの値。Drive では 1 ファイルを丸ごと読む |

1 レコードは暗号文で 16KB まで、Base64URL で約 22KB。セグメントの 512KB に最低でも 20 件以上入る。

### 2.5 まとめ直し(compaction)

**誰が:** 書いた端末だけが、自分のファイルだけをまとめ直す。

**いつ:** 閉じたセグメントが 7 つ以上、または閉じたセグメントの合計が 2MB 以上になったとき。**または自分の最古のファイル(開いているセグメントも)を最後に書いてから 60 日(`DRIVE_REWRITE_AGE_MS`)を過ぎたとき**(2.6。このときは開いているセグメントも閉じて入れる。入れるセグメントがなくスナップショットだけなら、使っていない通番を 1 つ取って `u` にし、前のスナップショットと混ざらないようにする)。周の最後(`SyncRemote.maintain()`)に、**手元の控え(`drive_own`)だけを見て決める**ので、条件を満たさない周は 1 回も呼び出さない。1 日 1 回まで(`drive_compact_at`)。セグメントは UTC の日が変わると閉じるので、毎日使う人でおよそ週に 1 回になる。

**何を入れるか:** 自分の古いスナップショットと閉じたセグメントに入れたレコード(開いているセグメントは入れない)。

- 入れたレコードの ID は、ファイルごとに `drive_own` に控える(`snap`: `u`・`uv`・`g`・部分のファイル ID・レコード ID・書いた時刻 `at`、`segs`: 閉じたセグメントごとの通番・ファイル ID・最後の版・大きさ・レコード ID・最後に書いた時刻 `at`)。セグメントを閉じたときに足す。`at` のない控え(前の版のもの)は 0 とみなし、すぐ書き直す
- 初めの案の「`sync_records` の『自分が送った』印で選ぶ」はやめた。印の列を足すには同期の表の形を PC とスマホの両方で変える必要があり、ID の控えで同じことができるため
- 中身は同期の表の今の値で封をし直す(古いファイルを読み戻さない)。HLC の壁時計が 90 日より古い tombstone は落とす
- **表にないレコード**(権限系を切った端末・手元で期限が切れたもの)は、古い自分のファイルをダウンロードして、暗号文のまま引き継ぐ(切った端末のまとめ直しで Drive から値を消さないため。開いて 90 日より古い tombstone なら落とす)。表にないものがあるときだけ読むので、ふだんのまとめ直しはダウンロードしない
- `g` は、この回で tombstone を本当に落としたら基準の時刻(今 − 90 日)、落とさなければ前のスナップショットの `g`(初めは 0)。読む側は「最後に落とした基準」だけを見ればよい。どこにもない・開けないレコードを捨てただけでは `g` を進めない(進めると、ほかの端末が要らないリベースをする)

**手順(順番が大事):**

1. 入れるレコードを決めて封をし、4MB ごとの部分に分ける(レコードがなくても 1 部分は作る。`u` と `g` を伝えるため)。**部分ごとのレコード ID**・`u`・`uv`・`g`・基準の時刻・消す古いファイルを `drive_compact` に置く
2. 部分を 1 つずつ作り(`files.create`)、作るたびに `drive_compact` に作り終えた部分の ID を足す
3. 全部を作り終えたら、古いスナップショットの全部分と、含めたセグメントを消す(`files.delete`。もう消えていた 404 は済んだものとする)
4. `drive_own` を新しいスナップショットと、まだ含めていないセグメントに置き換え、`drive_compact` を消す

途中で落ちても、次の周で `drive_compact` の続きから作る(部分の分け方は 1 で決めてあるので、作り終えた部分を作り直さない。続きの部分は落とさずに封をする。残すと決めた tombstone も部分に入っているため)。容量の超過(`storageQuotaExceeded`)で作れないときは周を失敗にせず、1 日おいて続ける。回数の上限(429)も周を失敗にせず、次の周で続ける。

**呼び出しの数(1 回):** 作る 1 回(4MB ごとに 1 回)+ 消す「閉じたセグメントの数 + 古いスナップショットの部分の数」。一覧もダウンロードもしない。7 つ閉じたときで 作る 1 + 消す 8 = 9 回、約 450 単位。

**消している最中に他の端末が読んだら:**

| 場面 | 動き |
| --- | --- |
| 新しいスナップショットの部分がまだ揃っていない | 揃うまで、その書き手については古いスナップショットとセグメントを読む(古いものはまだ消えていない)。変更の一覧の中で部分が揃っていないときだけ `files.list` を 1 回呼び、ほかの部分がもうあるかを見る。揃わない部分は控え(`drive_seen`)に入れないので、残りの部分ができたときにまた来る |
| 変更で見たファイルを読もうとしたら消えていた(404) | 同じ token から変更を 1 回だけ読み直す(初めの案の `files.list` の代わり。読み直すと消えた印と新しいスナップショットが来て、下の決まりで読む)。2 回続けば周の失敗(次の周でまた読む) |
| 新しいスナップショットの中身を、自分がもう全部読んでいる | **スナップショットを読まない**(控えだけ進める)。ダウンロードを 1 回減らす。決め方は下 |
| `g` が、自分がその領域を最後に読み終えた時刻より新しい | 知らない削除が落とされたかもしれないので、リベース(`planRebase`。2.6・3.5) |

**「もう全部読んでいる」の決め方:** 書き手ごとに、読んだセグメントの最大の通番 `n` と、そのとき読んだ版 `v` を `drive_read_upto` に置く。セグメントは閉じた後は変わらないので、`n` を読んだ時点で `n` より前のセグメントは最後の版まで読んである。スナップショット(`u`・`uv`)は `u < n`、または `u = n` かつ `v ≥ uv` なら読まない。

- 初めの案(「`u` が読み終えた通番以下なら読まない」)では、まとめ直しは前の日のセグメントを閉じた周に起きるので、閉じたばかりのセグメント `u` を最後の版まで読んだかが分からず、毎回スナップショットを読むことになる。`uv` を書き手が付け、読む側は自分の読んだ版と比べる
- スナップショットを読んだら `drive_read_upto` は (`u`, `uv`)。スナップショットに含まれたセグメントは読まずに控えだけ進める

どの場合も、作る → 消すの順なので「どこにもない」瞬間がない。読む側のマージは冪等なので、同じレコードを 2 度読んでも害がない。

**2 台が同時にまとめ直す:** それぞれ自分のファイルだけを作って消すので、ぶつからない(共通シナリオと `driveRemote.test.ts` で確かめる)。

**同じレコードが複数の書き手のファイルにある:** 端末 A と B の両方が同じレコードを書けば、両方のスナップショットに入る。合わせても全体は「端末の数 × レコードの数」まで。2〜3 台では問題にならない。負けた値を落とす工夫(他の書き手の新しい値を見たら自分の古い値を落とす)は、他の書き手のファイルが消えたときに値を失うので、まずは行わない。

**やめた端末のファイル:** 「この端末で同期をやめる」は自分のファイルを消さない(その端末の `read_dev` が残らないと既読位置が下がる。今の U9 と同じ)。もう書かない端末のファイルは、tombstone を落とす側が確かめる(2.6 の「止まった書き手」)。引き取って消す仕組みは作らない(他人のファイルを消すと、書き手が戻ってきたときにぶつかる。確かめるだけなら他人のファイルに触らない)。

### 2.6 tombstone の片づけ

| 決まり | 内容 |
| --- | --- |
| 落とすのは書き手 | まとめ直しで、自分のスナップショットから、HLC の壁時計が 90 日より古い tombstone を落とす。基準の時刻を `g` に書く |
| 手元の保持は今のまま | 同期の表の tombstone は `tomb_at` から 90 日(`settleRecord`・`isTombExpired`) |
| 読む側の気づき | ある書き手の `g` > 自分がこの領域を最後に読み終えた時刻(`drive_read_at`)なら、全件を読み直して `planRebase`。今の `since < gc_floor` と同じ。`changes` は何も読まずに `gc_floor = since + 1` を返し、エンジンが `NeedsRebase` にする |
| リベースの全件に自分の分を入れる | Drive の全件の読み取りは自分のファイルを読まない(3.4)。そのままでは `planRebase` が「自分しか持たないレコード」を全件にないとして消すので、リベースのとき(`drive_rebase` の印)だけ、Drive に今ある自分のファイルに入れたレコード(`drive_own`・`drive_seg` の ID)を同期の表の値で封をして全件に足す。ダウンロードはしない |
| 古いファイルを書き直す | 書き手は、自分の最古のファイル(開いているセグメントも)が 60 日(`DRIVE_REWRITE_AGE_MS`)を超えたら、手元の今の値でまとめ直す(2.5)。tombstone を落とす 90 日より必ず前に、古いファイルに残った「生きている値」を手元の値(届いた tombstone)で置き換える |
| 止まった書き手のファイル | tombstone を落とす前に、他人のファイルのうち最終更新(`modifiedTime`)が 75 日(`DRIVE_STALE_MS`)より古いものだけをダウンロードし、落とそうとしている tombstone の対象に、それより古い HLC の生きた値があれば、その tombstone は落とさない。最終更新は変更の一覧と全件の一覧で控える(`drive_mtime`)ので、一覧を呼び足さない |
| 90 日以上オフラインの端末 | 今と同じ制約(U14)。削除済みが戻ることがある |

**なぜ書き直しと確かめの両方か:** 書き手のファイルは、その書き手が送ったレコードしか含まず、まとめ直すまで古い値のまま残る。セグメントが 7 つ溜まらない端末(あまり使わない端末)は、まとめ直しの条件を満たさないので、何か月も前の生きた値を持ち続ける。相手がその tombstone を 90 日で落とすと、新しく参加した端末・リベースした端末は、古い生きた値だけを読んで消したものを戻す。

- 動いている書き手は 60 日ごとに書き直すので、そのファイルは「最終更新から 60 日以内の、手元の値(届いた tombstone を含む)」になる。75 日の境は、たまにしか開かない端末の分の余裕(書き直しは開いたときにしか起きない)
- 止まった書き手(やめた端末・もう開かない端末)は書き直せない。その書き手のファイルは最終更新が古いままなので、落とす側がダウンロードして中身を確かめる。生きた値が残っていれば tombstone を残し続ける(戻らないことを優先する)。HLC が tombstone より新しい生きた値は、tombstone がなくても勝つので確かめない
- 他人のファイルを消す・引き取る案はとらない。消された書き手が戻ってきたとき、自分のファイルの控え(`drive_own`)と Drive が食い違う。確かめるだけなら他人のファイルに触らない
- 呼び出しが増えるのは、止まった書き手がいて、かつ tombstone を落とすまとめ直し(多くて週に 1 回)のときだけ。止まった書き手のファイルの数だけダウンロードする
- 限界: 書き手が手元で一度も読まずに(tombstone を受け取らずに)書き直し続けると、生きた値を新しいファイルに書き続ける。送るだけの周は読まない(3.8)が、前面に戻ったとき・手動の同期・確認で変化を見たときは読むので、動いている書き手が 60 日の間に一度も読まないことは、手動のみで「今すぐ同期」を押さない場合に限られる

## 3. 読み方

### 3.1 変わったかの確認: `changes.list` か `files.list` か

| 比べる所 | `changes.getStartPageToken` + `changes.list` | `files.list` の `modifiedTime` |
| --- | --- | --- |
| 1 回の重さ | `getStartPageToken` は 5 単位(その他)、`changes.list` は 100 単位(一覧)([上限][limits]) | 100 単位(一覧) |
| 消えたファイル | 消えた印(`removed`)が来る(`includeRemoved`)([changes.list][changes-list]) | 来ない。前の一覧と比べないと分からない |
| 続き | `pageToken`。前回の続きだけが来る | 時刻で比べる。同じ時刻の取りこぼし・時計の精度を気にする必要がある |
| appDataFolder | `spaces=appDataFolder` が使える([changes.list][changes-list]) | `spaces=appDataFolder` が使える([files.list][files-list]) |
| 1 回の量 | 1,000 件まで(既定 100)。続きは `nextPageToken`、最後のページに `newStartPageToken`([changes.list][changes-list]・[変更の取得][changes-guide]) | 1,000 件まで |

**決定: `changes.list` を正にする。** 消えたことが分かり、続きを token が持つので取りこぼしがない。

**前置きの確認:** 1 分ごとの確認では、まず `changes.getStartPageToken`(5 単位)を呼び、手元の token と同じなら「変化なし」(今の 304 と同じ扱い)。違うときだけ `changes.list` を呼ぶ。

- `getStartPageToken` は Drive 全体の変更の位置で、appDataFolder だけのものではないとみられる(引数に `spaces` がない)。利用者がほかの Drive のファイルを触ると token が進み、空の `changes.list`(100 単位)が増える。**変化を見逃さない(同じ token なら変更がない)ことは公式に書いていない(未確認)。** 段階 D3 で本物の Drive で確かめ、ずれるなら前置きをやめて毎回 `changes.list` にする(確認 1 回が 5 単位から 100 単位になる)
- token は文字列として比べるだけで、中身を解釈しない

### 3.2 新しいファイルだけを読む

`changes.list` は `fields` で次だけを取る。

```
changes(fileId,removed,file(id,name,appProperties,version,size,trashed)),nextPageToken,newStartPageToken
```

| 変更 | 動き |
| --- | --- |
| `s` が自分の領域でない・`f` が知らない版 | 読まない(別の鍵の領域。6 章) |
| `d` が自分の `device_id`・自分が書いたファイルの ID(`drive_own`) | **読まない**(自分の書いたものを読み戻さない) |
| 他の端末の `seg`・`snap` で、`version` が控え(`drive_seen[fileId]`)より大きい | ダウンロード(`files.get` の `alt=media`、200 単位)して `openRecords`・マージ。控えを更新 |
| `snap` で `u` ≤ その書き手の読み終えた通番 | 読まない(2.5)。控えだけ更新 |
| `snap` の部分が揃っていない | 揃うまで読まない |
| `removed` | 控えから外すだけ。**手元のデータを消さない**(削除は tombstone でだけ伝わる) |
| 目印 `space` が `removed`・`e` が違う | 作り直し(3.6) |

1 つの周で読むのは、変わったファイルごとに最新の版を 1 回。セグメントは上書きなので、相手が何回送っても、こちらが読むのは 1 回で済む。

### 3.3 ページング

- `pageSize=1000`。`nextPageToken` があるあいだ続け、最後の `newStartPageToken` を `drive_token` に置く
- token は**ページの中身を同期の表に書き終えてから**進める(今の `since` と同じく、途中で落ちても次で続きから読める)
- 進まない(同じ token が返る)なら止める(今の `no_progress`)
- ~~1 回の周で読むファイルの数に上限(50)を置き、残りは次の周~~ **置かない。** まとめ直しで、書き手ごとのファイルは「スナップショットの部分 + 閉じたセグメント 7 つまで + 開いているセグメント 1 つ」に収まり、2〜3 台なら 1 周で読むのは多くて 30 ほど(合流と同じ)。上限を置くと、読み残したファイルの控えを token とは別に持つ必要があり、取りこぼしの元になる

### 3.4 全件の読み取り(合流・リベース・作り直し)

1. `files.list`(`spaces=appDataFolder`、`pageSize=1000`、上の `fields`)で全ファイルの一覧(100 単位。2〜3 台なら 1 ページ)
2. 先に `changes.getStartPageToken` を取っておく(一覧の後に起きた変更を次の周で拾うため)
3. 自分の領域の、他の端末の、完全なスナップショット(部分が揃ったもの)と、それより新しいセグメントを読む。自分のファイルは読まない(手元が正)
4. 全部を読めたら `complete: true`。1 つでも読めなければ `false`(`planRebase` は届いていないものを消さない)

`files.list` の `q` で `appProperties` を絞ることもできる([検索の言葉][search])が、2〜3 台の 1 ページでは要らないので、手元で分ける。

### 3.5 リベース

`drive_read_at`(最後に全部の変更を読み終えた時刻)より新しい `g` を見たら、3.4 で全件を読み `planRebase`。確認(大量の削除)と回数の制限(1 日 3 回)は今のまま。

初めの案の「または `drive_read_at` が 90 日より前なら」は入れない。落とした tombstone は必ず書き手の `g` に出るので、`g` だけで足りる。90 日で決めると、何も落とされていないのに全件を読み、確認を出すことがある。

### 3.6 領域が消えたとき(作り直し)

| 気づき方 | 動き |
| --- | --- |
| 目印がない(全件の一覧にない・`removed`) | 自分で目印を作る(新しい `e`)。`epoch` を書き換えて、今の `planRecreate`(手元を消さない、全部を送る) |
| 目印の `e` が手元の `epoch` と違う | 同じく `planRecreate` |
| 目印が 2 つ(2 台が同時に作った) | `createdTime` が古い方、同じなら `id` の小さい方を正にする。負けた目印を作った端末が自分のものを消す。正でない `e` で作り直した端末は、もう一度合わせ直す(マージは冪等。リベースの回数の制限に数える) |
| ~~自分の書いたファイル(`drive_own`)が全部なくなった~~ | **見ない。** 利用者が消せるのは「隠しアプリデータの削除」で、目印も一緒に消えるので、目印で気づける。開いているセグメントが消えていたときは、次の通番で作り直す(今のまま)。目印がなくて作り直すとき(`createSpace`)は、消えた自分のファイルの控え(`drive_own`・`drive_compact`)を捨てる |

作り直しの「全部を送る」は、自分の新しいスナップショット 1 つ(部分に分ける)を作る形にする。セグメントを何十回も書かない(3.8)。

### 3.7 `changes.list` の token が使えなくなったとき

token の期限は公式に書いていない(**未確認**)。`changes.list` が 400 などで token を断ったら、3.4 の全件の読み取りに切り替えて新しい token を取る。全件の読み取りは手元を消さない読み方(`planRecreate` と同じくマージだけ)にする。

### 3.8 送るだけの周と、まとめて送るとき

- **送るだけの周は読まない。** Drive は書き込みがぶつからない(409 がない)ので、送る前に読む必要がない(`SyncRemote.pushWithoutPull`)。確認の時計・裏へ回る瞬間の周は、直前の確認が「変化あり」だったときだけ読む。手動のみの間隔では、自動の周は送るだけになる(説明どおり)。前面に戻ったとき・手動の同期は今のまま読む
- **全件の送信はスナップショットへ直接書く。** 種まき・作り直し・参加では送るものが数千〜数万件になる。Drive の 1 回の送信は 5,000 件・8MB まで(`DRIVE_PUSH_RECORDS`・`DRIVE_PUSH_BYTES`。サーバーは 100 件・1MB)にし、その本文がセグメント(512KB)に収まらなければ、セグメントを上書きせずに、自分のファイル全部と今回の分を新しいスナップショットにまとめて書く(まとめ直しと同じ作り方・同じ `drive_compact` の続きの決まり。tombstone は落とさず `g` を変えない)。1 万 5 千件(約 10MB)で、作る 6 回・消す 3 回ほど(100 件ずつのセグメントの上書きなら 150 回、本文の合計は件数の 2 乗で増える)

## 4. API の呼び出し回数と上限

### 4.1 Drive API の上限の仕組み(2026-05-01 からの単位の方式)

公式の文書([Usage limits][limits])の値。2026-05-01 に「回数」から「単位」の数え方に変わった。

| 上限 | 値 |
| --- | --- |
| 1 分・1 プロジェクト | 1,000,000 単位 |
| 1 分・1 ユーザー・1 プロジェクト | 325,000 単位 |
| 1 日の送り出し(egress) | 1TB |
| 超えたとき | `403 User rate limit exceeded` または `429 Rate limit exceeded`。切り詰めた指数バックオフで送り直す |

| 呼び出し | 区分 | 単位 |
| --- | --- | --- |
| `changes.getStartPageToken` | その他 | 5 |
| `files.get`(メタデータ) | 読み | 5 |
| `changes.list`・`files.list` | 一覧 | 100 |
| `files.create`・`files.update`・`files.delete` | 編集 | 50 |
| `files.get` の `alt=media`(ダウンロード) | ダウンロード | 200 |
| `oauth2.googleapis.com/token`(トークンの更新) | Drive の単位に数えない | — |

1 分の窓が固定か滑るかは書いていない(**未確認**)。

### 4.2 呼び出しを減らす作り

| 作り | 減るもの |
| --- | --- |
| 前置きの確認(3.1) | 1 分ごとの確認は `getStartPageToken`(5)だけ。変わったときだけ `changes.list`(100) |
| 自分の書いたものは読み戻さない(3.2) | 自分の送信の後の確認でダウンロードしない |
| 1 回の送信 = 開いているセグメントの上書き 1 回(2.1) | 相手が何回送っても、こちらが読むのは変わったファイルごとに 1 回 |
| 送るだけの周は読まない(3.8) | 手動のみ・送信の時計の周で `changes.list` とダウンロードをしない |
| 全件の送信はスナップショットへ直接(3.8) | 種まき・作り直し・参加でセグメントの上書きを連打しない |
| まとめ直し(2.5) | 書き手ごとのファイルを「スナップショット + 閉じたセグメント 7 つまで + 開いているセグメント」に収め、合流の読み取りを少なくする。条件は手元の控えだけで決め、満たさない周は呼ばない |
| もう全部読んだスナップショットは読まない(2.5) | 相手のまとめ直しの後のダウンロード |
| 使っている量の表示 | `files.list` は画面を開いたときと同期の後だけ。止まっている(`blocked`)間は呼ばない |

共通シナリオと `driveRemote.test.ts` で、一覧・ダウンロード・作成の回数の上限を確かめる(9.2)。

**Google の容量:** appDataFolder のファイルは利用者の Drive の容量に数えられるとみられるが、公式の文書で確かめられなかった(**未確認**)。

## 5. 認証の流れ

### 5.1 全体

```
PC(1 台目)                           Google                     スマホ・2 台目の PC
「Google でログイン」
  ├ 既定のブラウザで同意画面 ───────▶ 同意(drive.appdata)
  ├ 127.0.0.1 のループバックで code ◀── リダイレクト
  ├ code + PKCE で token へ ─────────▶ refresh token・access token
  ├ K を作る。K と refresh token を OS の資格情報へ
  └ 「端末を追加」で QR(K + refresh token)──────────────────────────▶ 読む
                                                                       ├ Keystore で包んで置く
                                       access token ◀──── refresh ────┤(同じクライアント ID とシークレット)
                                                                       └ appDataFolder を読み書き
```

### 5.2 PC(Tauri): ループバック + PKCE

公式の「インストールしたアプリ」の手引き([OAuth for iOS & Desktop Apps][native])に従う。

| 手順 | 内容 |
| --- | --- |
| 1 | Rust で `127.0.0.1` の空いた港に 1 回だけ受ける HTTP の口を開く(`localhost` ではなく `127.0.0.1`。公式は `localhost` も使えるが、ファイアウォールで問題が出ることがあると書く) |
| 2 | `code_verifier`(43〜128 文字のランダム)と `code_challenge = Base64URL(SHA-256(verifier))`(`S256`)、`state` を作る |
| 3 | **既定のブラウザ**(`tauri-plugin-opener`)で `https://accounts.google.com/o/oauth2/v2/auth?client_id=…&redirect_uri=http://127.0.0.1:<港>&response_type=code&scope=https://www.googleapis.com/auth/drive.appdata&code_challenge=…&code_challenge_method=S256&state=…` を開く。アプリの中の WebView では開かない(Google は埋め込みの WebView を断る: `disallowed_useragent`) |
| 4 | 口に戻った `code` と `state` を確かめ、ブラウザには「OBB に戻ってください」とだけ返して口を閉じる。5 分で打ち切る |
| 5 | `https://oauth2.googleapis.com/token` へ `code`・`code_verifier`・`client_id`・`client_secret`・`redirect_uri`・`grant_type=authorization_code` を送る。インストールしたアプリには refresh token が必ず返る |
| 6 | `about.get`(`fields=user(permissionId,emailAddress)`。`drive.appdata` で呼べる([about.get][about]))で、どのアカウントかを確かめて画面に出す。`permissionId` を `sync_state.google_account` に置く(別のアカウントでのログインし直しに気づくため) |

- 公式は「デスクトップのアプリは公開のクライアントで、秘密を守れない」と書く。シークレットは配る版に入る前提で扱い、守りに使わない(PKCE と、ループバックの口が 1 回で閉じることが守り)
- `sync_http` に `PATCH`(`files.update`)を足し、通信先に `oauth2.googleapis.com`・`www.googleapis.com` が来ることを前提にする(https だけ・リダイレクトをたどらないは今のまま)
- **トークンの露出(実装):** access token は WebView へ返さない。WebView の Drive の置き場は要求に目印(`Bearer obb-google-access-token`)だけを付け、`sync_http` が Drive の API の先(`www.googleapis.com`)にだけ本物に差し替える。refresh token が WebView へ出るのは、端末を足すコード(obb2)を作るとき(`google_pairing_token`)と、コードを貼って参加するとき(`google_adopt` に渡す)だけで、どちらも `main` の窓に限る。`K` が WebView に入る(今の 12 章の 10)のは変わらない

### 5.3 スマホ: QR で受け取ったトークンで更新する

- Google のログインの画面を出さない。Google Play 開発者サービスの部品(`play-services-auth`)も使わない
- `https://oauth2.googleapis.com/token` へ `grant_type=refresh_token`・`refresh_token`・`client_id`・`client_secret` を OkHttp(同期専用の、リダイレクトをたどらない `OkHttpClient`)で送る。access token は 1 時間([Android の手引き][android-authz]・[OAuth for iOS & Desktop Apps][native])。メモリだけに持ち、期限の 5 分前か 401 で更新する
- クライアント ID とシークレットは PC と同じ値を `BuildConfig` に入れる
- Google の Android の推奨は、認証は Credential Manager、Drive などの許可は `AuthorizationClient` で、端末に refresh token を置かないこと([Android の手引き][android-authz])。デスクトップのクライアントのトークンを Android で使う形はその推奨から外れる。技術としては普通の HTTPS の要求で、スマホは Keystore で包んで置く(5.4)

### 5.4 トークンの置き場

| 端末 | 置き場 | 中身 |
| --- | --- | --- |
| PC | 今の `sync_key` と同じ OS の資格情報(Windows の資格情報マネージャー・Linux の Secret Service)に、`K` とは別の項目(`google-<DB の置き場ごとの名前>`。`src-tauri/src/sync_key.rs` の `google_user`)で置く | `{ refresh_token, account, email }` の JSON。読み書きするのは Rust の `google_auth.rs` だけで、命令にしない(WebView から読めない)。`SyncKeyMaterial` には入れない |
| スマホ | 今の `SyncKeyVault`(Android Keystore の AES-GCM で包んだ専用の Prefs `sync_key`) | `SyncKeyMaterial.google`(refresh token)。`K` と一緒に動く。アカウントの `permissionId` とメールは同期の表の外の `sync_state`(`google_account`・`google_email`)に置く |
| どちらも | access token はメモリだけ。同期の表・`settings`・書き出し・バックアップに入れない(今の `K` と同じ検査) | |

PC で参加の確認(5.5)に答えずに終わったとき、確かめるために置いたトークンが残る。`sync_state` の `google_adopted` の印を見て、次の起動で消す。

### 5.5 QR の中身

```
obb2.<K の Base64URL>.<refresh token の UTF-8 の Base64URL>
```

- 接頭辞を `obb2` にして、今の `obb1`(`K`・サーバーの URL・許可証)と見分ける。両方を選べる間は両方を読む
- サーバーの URL と許可証は入れない。アカウントの名前(メール)も入れない(読んだ端末が `about.get` で確かめて出す)
- 長さは約 43 + 140 文字。今の `obb1`(約 200 文字)と同じくらいで、QR に収まる
- 60 秒で消す・`FLAG_SECURE` は今のまま(PIN は作らない)
- コピーしたコードは、表示を閉じたとき・60 秒が過ぎたとき・窓を閉じるとき(`beforeunload`)に、クリップボードの今の中身が自分のコードのときだけ消す(その後に利用者がコピーしたものを消さない)。OS のクリップボードの履歴(Windows の Win + V など)には残ることがあるので、コピーのボタンの近くにそう書く
- スマホの貼り付けの欄は、自動の修正と予測を切る(`autoCorrectEnabled = false`・`KeyboardType.Password`)。参加できたら、クリップボードの中身がそのコードのときだけ消す
- 読んだ端末は `about.get` でアカウントを出し、**手元が空でも**参加の確認(`join_data`)を出して「Google アカウント: <メール>」を見せる(どのアカウントの同期に入るかを、参加の前に確かめる)。手元に送るものがあるときは今の文(送られるもの)、ないときは「この Google アカウントの同期に参加します」
- 共通テスト `sync-pairing.json` に `obb2` の例を足す

### 5.6 同じトークンを複数の端末で使うときの注意

| 項目 | 内容 |
| --- | --- |
| 更新の競合 | 公式の更新の応答の例に新しい refresh token はない([OAuth for iOS & Desktop Apps][native])。同じ refresh token で何台が同時に更新しても、それぞれが別の access token を受け取るだけで、ぶつからないとみられる。**更新で refresh token が入れ替わらないことは公式に明記がない(未確認)。** 応答に `refresh_token` が入っていたら、その端末は新しい値に置き換え、ほかの端末が `invalid_grant` になったら 5.7 の配り直しへ |
| トークンの数の上限 | 1 つの Google アカウント・1 つのクライアント ID につき refresh token は 100 まで。超えると一番古いものが黙って無効になる([OAuth 2.0][oauth2])。QR で同じものを配るので台数では増えない。増えるのは PC でログインし直したときだけ |
| 6 か月使わない | 6 か月使われない refresh token は無効になることがある([OAuth 2.0][oauth2])。同期を使っている端末は 1 時間ごとに更新するので当たらない |
| 取り消しは全端末に効く | 同じ許可を共有しているので、1 台で取り消す(`/revoke`、または Google アカウントの「サードパーティのアプリとサービス」で外す)と、全端末が止まる |
| 漏れたとき | トークンだけでは中身は読めない(`K` がない)。暗号文を読む・消す・置くことはできる。今の `auth_token` だけが漏れたときと同じ重さ。QR には `K` も入るので、QR の扱いは今と同じ |

### 5.7 取り消し・期限切れ・配り直し・ログアウト

| 場面 | 気づき方 | 動き |
| --- | --- | --- |
| テスト中の 7 日の期限 | 更新が `invalid_grant` | 同意画面が「テスト」の間は、refresh token が 7 日で切れる([OAuth 2.0][oauth2]・[対象][audience])。全端末が同時に止まる。下の「配り直し」 |
| 利用者が Google の側で取り消した・100 本を超えた・6 か月 | 同じ | 同じ |
| 401(access token の期限切れなど) | Drive の応答 | 1 回だけ更新して送り直す。だめなら上と同じ |
| **配り直し** | `blocked`(`google_auth_failed`) | PC: 「Google でログインし直す」(`K` と同期の表はそのまま。新しい refresh token を置く。`about.get` の `permissionId` が前と違えば確認を出して止める)。スマホ・2 台目: PC の「端末を追加」の QR を読み直す。`K` が同じなら、使っている最中でもトークンだけを置き換える(今の `already_on` を、`K` が同じときだけ通す) |
| この端末で同期をやめる(ログアウト) | 利用者 | 手元の `K` とトークンを消すだけ。**`/revoke` を呼ばない**(呼ぶと全端末が止まる) |
| 全端末で Google の接続を切る | 利用者(詳しい設定。確認あり) | `https://oauth2.googleapis.com/revoke` に refresh token を送る。access token を送っても対の refresh token まで取り消される([OAuth for iOS & Desktop Apps][native])。Drive のファイルは残る(消すときは「領域を削除」を先に) |
| 領域を削除する(全端末) | 利用者 | その領域のファイルを全部消す(`files.list` + `files.delete` × 件数)。そのあと上の「やめる」 |

画面の言葉(案。`sync-ui.json` に足す):

| コード | 文 |
| --- | --- |
| `google_auth_failed`(PC) | Google との接続が切れました。もう一度 Google でログインしてください。この端末のデータはそのまま使えます。 |
| `google_auth_failed`(スマホ・2 台目) | Google との接続が切れました。PC で「端末を追加」の QR を出して、読み直してください。この端末のデータはそのまま使えます。 |
| `google_other_account` | 前と違う Google アカウントです。同期のデータは前のアカウントにあります。 |
| `drive_quota` | Google ドライブの容量がいっぱいなので、送るのを待っています。ドライブに空きを作ると、1 時間ほどで続きを送ります。この端末のデータはそのまま使えます。 |

### 5.8 将来、スマホだけで始める形(今は作らない)

スマホに Android 用のクライアント(署名の SHA-1)を足し、`AuthorizationClient` で access token を得る形。その場合スマホは refresh token を持たないので、スマホから PC へトークンを配れず、PC は自分で Google にログインする(同じアカウントか `permissionId` で確かめる)。

## 6. 鍵と Google アカウントの関係

| 場面 | 結果 |
| --- | --- |
| 同じアカウント・同じ `K` | 同じ領域(`s` が同じ)。普通の同期 |
| 同じアカウント・違う `K`(別の人が同じアカウントで始めた、鍵を作り直した) | 別の領域。お互いのファイルは `s` が違うので読まない(読んでも AAD が合わず開けない)。appDataFolder の中に領域が並ぶ |
| 違うアカウント・同じ `K` | 置き場が別なので届かない。QR にトークンが入るので、ふつうは起きない。PC でログインし直したときだけ `permissionId` で止める |

- **領域(`space_id`)は残す。** 今の `space_id = SHA-256(auth_token)` をそのまま使う(`auth_token` は Bearer としては使わなくなるが、導出と AAD を変えないため)
- 鍵のローテーション(段階 8)は「新しい `K'` の領域へ全部を書き、古い領域のファイルを消す」で今と同じ
- 同じアカウントに残った古い領域(使わなくなった `K` のファイル)は、誰の端末からも読めない。片づける画面は今は作らない(作るなら、詳しい設定に「このアカウントのほかの OBB の同期のデータを消す」。一覧は `files.list` で `s` の違うものを数えるだけ)

## 7. いまのサーバーからの移り方

### 7.1 置き場の種類(実装)

初めの案の「詳しい設定で同期サーバーと Google ドライブを選ぶ・移る期間を設ける」はやめた。置き場はビルドで決まる。

| 項目 | 決まり |
| --- | --- |
| 保存先 | `sync_state.store`: `drive` だけを書く。ない端末は同期サーバーで使っていたもの |
| Google のクライアントの入った版 | 置き場は Drive だけ。サーバーで使っていた端末は、起動したときに同期をやめた状態に戻す(`retireServer`。手元のデータ・同期のスイッチ・種類ごとのスイッチ・間隔は残す。案内 `server_sync_ended` を最後のエラーに出す)。Google で始め直すか、PC のコードを読み直す |
| クライアントの入っていない版 | サーバーで使っていた端末はサーバーのまま動かす(戻さない)。新しく始めることはできない(`google_unavailable`) |
| QR | `obb2` を読めば `drive`。スマホは `obb1` を読むと `server_code` で断る |
| 混ざらない | `server` の端末と `drive` の端末は互いに届かない |

### 7.2 エンジンの「置き場」の差し替え口

今の `SyncApi` の 4 つの口(`head`・`changes`・`pushRecords`・`createSpace`)を `SyncRemote` という口に切り出し、今のサーバーの実装と Drive の実装を差し替える。エンジンの周の順(draining → pull → apply → push)・リベース・作り直し・確認・429 の待ちは変えない。

| 口 | サーバー(今) | Drive |
| --- | --- | --- |
| `head(etag)` | `GET /head` | `getStartPageToken` を手元の `drive_token` と比べる。同じなら `null`(304 と同じ)。違えば `changes.list` を読み、他の端末の変化があれば `version = since + 1`(変化あり)、自分のファイルだけなら token を進めて `null` |
| `changes(since)` | `GET /changes` | 3.2 のとおり新しいファイルを読み、各レコードに `version = since + 1, +2, …` を振って返す。`head` は通番、`more` はまだ読むファイルがあるか、`epoch` は目印の `e`、`gc_floor` はリベースが要るとき `since + 1`(エンジンが `NeedsRebase` にする)。`since = 0` は 3.4 の全件 |
| `pushRecords(id, records)` | `POST /records` | 開いているセグメントの中身(今までの分 + 今回の分。同じレコードは新しい方)を作って上書き(`files.update`。初回は `files.create`)。全件 `200` で `version = since + 1 …` を連番で返す(`pushedRun` が `since` を進め、自分のファイルを読み戻さない)。409 は返さない |
| `createSpace(ticket)` | `POST /spaces` | 目印を作る(なければ)。`ticket` は使わない |
| `pace` | 応答の `pace` | いつも `null` |

- `version` はこの端末の中だけの通番になる。エンジンが使うのは「`since` との大小」と「0 か 0 でないか」だけなので、意味は保たれる。PC とスマホで値は違ってよい(共通テストの digest は置き場ごとに分ける。9 章)
- セグメントの中身を作るため、「このセグメントに入れたレコード ID」を `sync_state.drive_seg`(`n` と ID の一覧)に置く。中身は送るたびに `sync_records` から作り直して封をし直す(暗号文を保存しない。今の `push_inflight` と同じ考え)
- まとめ直し(2.5)は周の最後に `SyncRemote.maintain()` を呼ぶ形で足す(サーバーでは何もしない)。エンジンは変えない
- Drive の失敗はエンジンの今の分け方へ写す: 401 → 更新して 1 回送り直す、更新が断られた(429 以外の 4xx)・`403 insufficientPermissions` → `SyncApiError('http', 401)` 相当で `blocked`(コードは `google_auth_failed`)、`403 userRateLimitExceeded`・`rateLimitExceeded`・`dailyLimitExceeded`・`sharingRateLimitExceeded`・`429` → 429、`403 storageQuotaExceeded` → `413 quota_exceeded`(Drive では外さずに 1 時間待つ。`SyncRemote.quotaWaitMs`)、ダウンロードの 404 → 同じ token から変更を 1 回だけ読み直す(2.5)、5xx → バックオフ
- 新しい `sync_state` の項目: `store`・`drive_token`・`drive_seen`(fileId → version)・`drive_read_upto`(書き手 → [読んだセグメントの最大の通番, そのとき読んだ版]。2.5)・`drive_own`(自分のファイルと、それぞれに入れたレコード ID。2.5)・`drive_seg`(開いているセグメント。最後に書いた版 `v` と大きさ `bytes` も)・`drive_read_at`・`drive_compact`(途中のまとめ直し)・`drive_compact_at`(最後にまとめ直した時刻)・`drive_rebase`(リベースの全件に自分の分を足す印。2.6)・`drive_mtime`(他人のファイルの最終更新。2.6)・`google_account`・`google_adopted`(PC。参加の確認のためにトークンを置いた印。5.4)
- ~~`drive_vmax`~~ は置かない。振る番号は `since` の続きで、エンジンが読んだ分(`mergePage`)と送った分(`pushedRun`)で `since` を必ず進めるので、`since` がそのまま「振った最大」になる

### 7.3 サーバーの領域から Drive へ移る流れ

今の「サーバーの URL を変えた」(`setServerUrl`: `since = 0`・`recreate_pending = 1`)と同じ流れを使う。手元のデータと同期の表が正なので、サーバーから何かを運ぶ必要はない。

1. PC で「同期の置き場」を Google ドライブにする → Google でログイン(5.2)
2. `K` はそのまま(`space_id` も同じ)。`store = drive`、`since = 0`・`recreate_pending = 1`、`epoch`・`gc_floor`・`push_inflight` を消す
3. 次の周で Drive の全件を読む(空)→ `planRecreate` → 手元の全部を自分のスナップショット 1 つに書く(3.8 の全件の送信)
4. スマホは PC の新しい QR(`obb2`)を読む。`K` が同じなので、同期の表を残したまま置き場とトークンだけを替え、同じく 2〜3 を通す。合流のマージで揃う
5. 移った端末は、今のサーバーへ何も送らない(古い領域は放置削除の 90 日で消える。急ぐなら移る前に「領域を削除」)

**限界:** 移行の間に `server` の端末でした変更は、その端末が移るまで `drive` の端末に届かない(移るときの `planRecreate` で届く)。

### 7.4 サーバーを消す手順

| 順 | 内容 |
| --- | --- |
| 1 | Drive の版を出す |
| 2 | アプリの既定を「Google ドライブ」にし、`server` の端末に「置き場を移してください」を出す |
| 3 | サーバーの `CREATION_CLOSED=1`(新しい領域を作らせない) |
| 4 | 期間の終わりに `READ_ONLY=1`、そのあと管理 API の全削除(`delete-all`)で中身を消す |
| 5 | Worker・Durable Object・KV・ドメイン `sync.red-edge.net` の設定・`wrangler secret`(`TICKET_KEYS`・`TURNSTILE_SECRET`・`ADMIN_KEYS`)・Turnstile のウィジェットを消す |
| 6 | アプリから `server` の置き場を外す: `apps/sync-server`、`pow.ts`・`SyncPow.kt`、許可証と `/start` の窓(`sync_start.rs`・スマホの窓)、`server-url.json`、`obb1` の読み取り、共通テストの `sync-ticket.json`・`sync-pow.json`・`sync-server-rules.json`(Drive の決まりに置き換え)、シナリオの 54〜59 など |
| 7 | 文書: `docs/sync-design.md` の API・サーバー・許可証・費用の節と `docs/sync-security.md` のサーバーの部分を、この文書の内容で書き直す |

## 8. 本人に頼む準備(Google Cloud)

画面は Google Cloud コンソールの「Google Auth Platform」。英語の画面の名前で書く(日本語の表示の名前は**未確認**)。作るクライアントは**「デスクトップ アプリ」の 1 つだけ**。Android 用のクライアントと SHA-1 は要らない。

| 順 | 画面 | すること |
| --- | --- | --- |
| 1 | コンソール上部のプロジェクトの選択 → **New project** | プロジェクトを作る(例: `obb-sync`)。組織はなし |
| 2 | **APIs & Services → Library** | 「Google Drive API」を探して **Enable** |
| 3 | **Google Auth Platform → Branding**(`https://console.cloud.google.com/auth/branding`) | App name `OBB`、User support email、Developer contact email。ロゴは入れない(ロゴを出すにはブランドの確認が要る)。App home page・Privacy policy・Terms of service の URL(公開する前までに。持っているドメインの上に置く) |
| 4 | **Audience**(`/auth/audience`) | User type **External**。Publishing status は **Testing** のまま。**Test users** に自分と試験に入る人の Google アカウントを足す(100 人まで。足した人は消しても数が戻らない)([対象][audience]) |
| 5 | **Data Access**(`/auth/scopes`) | **Add or remove scopes** → `https://www.googleapis.com/auth/drive.appdata` を足す(非機密の範囲([appdata][appdata])) |
| 6 | **Clients**(`/auth/clients`) | **Create client** → Application type **Desktop app** → 名前 `OBB desktop` → **Create**。クライアント ID とシークレット(JSON)を控える。リダイレクト URI の登録は要らない(デスクトップ アプリはループバックが使える) |
| 7 | 控えた値を開発者へ渡す | リポジトリに入れない。PC はビルドのときに環境変数 `OBB_GOOGLE_CLIENT_ID`・`OBB_GOOGLE_CLIENT_SECRET`、またはその 2 行(`KEY=VALUE`)を書いたファイルを `OBB_GOOGLE_OAUTH_FILE` で指して入れる(`src-tauri/build.rs`。どちらもなければ Google の同期のないビルドになる)。CI のリリース(`.github/workflows/release.yml`)は GitHub の secrets の `OBB_GOOGLE_CLIENT_ID`・`OBB_GOOGLE_CLIENT_SECRET` を渡す。スマホは同じ環境変数かファイルを Gradle が読む(`app/build.gradle.kts`) |
| 8(試験が済んだら) | **Audience → Publish app** | 「In production」にする。テスト中は refresh token が 7 日で切れ、テストユーザーしか使えない。公開すると誰でも使え、7 日の期限がなくなる。非機密の範囲だけなので、本格の審査は要らない見込み(公式の説明は「機密・制限の範囲は審査が要る」で、非機密だけのときに何が要るかは、ブランドの確認(ホームページ・プライバシーポリシー・ドメインの確認)以外は**未確認**)([審査][verification]・[審査の要件][verification-req]) |

## 9. 作る順番と試験の計画

### 9.1 偽の Drive

テストの置き場として、Drive API の使う部分だけをメモリで真似る `FakeDrive` を TS(`packages/sync/test/fakeDrive.ts`)と Kotlin(`FakeDrive.kt`)に作る。決まりは新しい共通テスト `packages/conformance/sync-drive-rules.json` に例で書き、両方が同じ応答を返すことを確かめる(今の `sync-server-rules.json` と同じ形)。

| 真似るもの | 決まり |
| --- | --- |
| `files.create`(multipart)・`files.update`(PATCH multipart)・`files.delete`・`files.get`(メタデータと `alt=media`)・`files.list`・`changes.getStartPageToken`・`changes.list`・`about.get` | 応答の形と `fields` の一部。`version` は書くたびに増える。変更の一覧は時刻順、`removed` を含む |
| token の endpoint | `refresh_token` → access token(期限つき)。取り消し・7 日の期限・`invalid_grant` を差し込める |
| 故障 | 401・403(`userRateLimitExceeded`・`storageQuotaExceeded`)・429・404・500・応答の欠け・ダウンロードの途中の削除 |
| 単位の勘定 | 呼び出しごとに 4.1 の単位を数える。呼び出しの数の上限をテスト(共通シナリオの `lists_at_most`・`downloads_at_most` と `driveRemote.test.ts`)で確かめる |

### 9.2 共通シナリオ(`sync-client.json`)を Drive で流す

- 実行部(`scenarioRunner.ts`・`SyncScenarioTest.kt`)に「置き場」を引数で足し、同じシナリオを `server` と `drive` で流す
- サーバーを操作する手順を Drive に写す

| 手順 | Drive での意味 |
| --- | --- |
| `server_delete_space` | 領域のファイルを全部消す(利用者が隠しアプリデータを消した) |
| `server_bump_epoch` | 目印の `e` を替える |
| `server_fail`・`server_unreachable`・`server_drop_response` | Drive の要求の失敗・切断・応答の欠け |
| `server_inject`・`server_inject_secret` | 他の端末のセグメントとしてファイルを置く |
| `server_response`・`server_redirect` | 応答の差し替え・リダイレクト(どちらも置き場の口で同じに扱う) |
| `server_swap_conflict` | Drive では起きない(409 がない)。`server` だけで流す |

- 置き場に関係のないシナリオ(ほとんど)は両方で流し、**今のデータ(画面が読むもの)の digest が両方で同じ**であることを確かめる。同期の表の digest は `version` の意味が違うので、`sync-client-digests.json` に置き場ごとの値を持つ
- 許可証・PoW・満員・作成の停止のシナリオ(39・54〜59 など)は `"stores": ["server"]` の印を付けて Drive では流さない。Drive だけのシナリオ(7 日の期限、トークンの配り直し、まとめ直しの最中の読み、目印の 2 重の作成、`g` によるリベース、`storageQuotaExceeded`、自分のファイルを読み戻さない、前置きの token で 304 相当)を足す
- 乱数のシナリオ(`sync-client-random.json`)と 300 シードの回しも `drive` で流す
- まとめ直しのシナリオ(`"stores": ["drive"]`)。手順 `repeat`(`{i}` を回の番号に置き換えて繰り返す)と、Drive だけの故障の道 `drive:snap`・`drive:delete`・`drive:seg`・`drive:list`・`drive:changes`・`drive:media`・`drive:token`、容量の確かめ(`files_at_most`・`bytes_at_most`・`record_copies_at_most`・`snap_parts`・`lists_at_most`・`downloads_at_most`)を使う
  - 120 日使う(毎日、新しいスレを読み・同じスレを読み直し・足したお気に入りを相手が外す): ファイルは 目印 1 + 端末ごとに 9 まで。まとめ直しなしでは 241 ファイル・677KB・レコードの写し 1,200 が、5 ファイル・360KB・670 に収まる。120 日の間に `files.list` は 0 回、相手のまとめ直しの後もスナップショットをダウンロードしない。後から参加した端末のダウンロードは 4 回(まとめ直しなしでは 240)
  - まとめ直しの途中の失敗(スナップショットを作れない・古いものを消す途中で切れる)、その最中の参加、8 日読まなかった端末の追いつき
  - 2 台が同じころにまとめ直す
  - 100 日読まなかった端末が、相手の落とした tombstone(`g`)でリベースし、消えたものを戻さない
  - 3 台目が古いセグメントを持ったまま止まり、91 日後に新しい端末が参加・ほかの端末がリベースしても、消したものが戻らない(2.6 の止まった書き手)
  - まとめ直しの条件を満たさない端末も、60 日で古いファイルを書き直す
- 本物の Drive への確かめ(`verifyServer.test.ts` の Drive 版)は、開発用の Google アカウントの refresh token を環境変数 `OBB_SYNC_VERIFY_DRIVE` に入れたときだけ回す。本人の普段のアカウントで回さない

### 9.3 PC と Kotlin の分担

| 部品 | PC(TS・Rust) | スマホ(Kotlin) |
| --- | --- | --- |
| `SyncRemote` の切り出し | `transport.ts` → `remote.ts`、`engine.ts` は口だけ使う | `SyncTransport.kt` → `SyncRemote.kt` |
| Drive の置き場 | `packages/sync/src/engine/drive.ts`(純 TS。通信は `SyncTransport` を借りる) | `obb/sync/engine/DriveRemote.kt`(先に PC で作り、写す) |
| 中身の形・名前・`appProperties` | `drive.ts` と共通テスト `sync-drive-rules.json` | 同じ |
| Google のログイン | PKCE の値と URL を作るのも、ループバックの口・ブラウザを開く・トークンの交換と更新・資格情報も Rust(`src-tauri/src/google_auth.rs`。値は Rust の試験で確かめる) | なし(QR だけ)。トークンの更新は OkHttp |
| QR `obb2` | `pairing.ts` | `SyncPairing.kt`・`SyncQr.kt` |
| 画面 | 置き場の選択・Google でログイン・ログインし直す・全端末で接続を切る | 置き場の表示・QR の読み直し |

### 9.4 段階

| 段階 | 内容 | 完了の目安 |
| --- | --- | --- |
| D0 | この文書の決めごとを本人と詰める。Google Cloud の準備(8 章の 1〜7) | クライアント ID がある |
| D1 | `SyncRemote` の切り出し(今のサーバーで全シナリオが今のまま通る)。`FakeDrive`(TS)と `drive.ts` | 共通シナリオが `server` と `drive` の両方で PC で通る |
| D2 | Kotlin の `FakeDrive`・`DriveRemote` | 共通シナリオが スマホの単体テストで `drive` でも通る。digest が PC と同じ |
| D3 | PC の Google のログイン(本物)と本物の Drive への確かめ。前置きの token が変化を見逃さないか、`files.update` の古い版が容量に数えられるか、token の期限、更新で refresh token が変わらないかを実測 | 開発者の PC 2 台(または PC と PC の別のユーザー)で同期する |
| D4 | QR `obb2` とスマホ。実機で PC とスマホが同期する。7 日の期限が来たときの配り直し | 開発者の 2 台が実機で同期する |
| D5 | 置き場の選択と移行(7.3)。両方を選べる版を出す | サーバーの端末が手元から Drive へ移り、2 台が揃う |
| D6 | 同意画面を公開(8 章の 8)。試験の人に案内 | 7 日の期限がなくなる |
| D7 | サーバーを消す(7.4) | `apps/sync-server` がない |

`docs/sync-security.md` の「限定の試験の前の条件」のうち、サーバーの項目(PoW・枠・Turnstile・管理 API・請求の警告)は Drive では要らなくなる。代わりに「トークンを資格情報の外に出さない」「`/revoke` を不用意に呼ばない」「偽の Drive の悪意のある応答(巨大なファイル・形の違う `appProperties`・別の領域のファイル)で端末が壊れない」を足す。安全の文書の書き直しは D5 の前に行う。

## 出典

確かめた日は 2026-11-09。

- [limits]: Google Drive API「Usage limits」 https://developers.google.com/workspace/drive/api/guides/limits(単位の方式は 2026-05-01 の更新)
- [errors]: 「Resolve errors」 https://developers.google.com/workspace/drive/api/guides/handle-errors
- [appdata]: 「Store application-specific data」 https://developers.google.com/workspace/drive/api/guides/appdata
- [props]: 「Add custom file properties」 https://developers.google.com/workspace/drive/api/guides/properties
- [search]: 「Search query terms and operators」 https://developers.google.com/workspace/drive/api/guides/ref-search-terms
- [changes-guide]: 「Retrieve changes」 https://developers.google.com/workspace/drive/api/guides/manage-changes
- [changes-list]: 「Method: changes.list」 https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/list
- [files-list]: 「Method: files.list」 https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list
- [files]: 「Files resource」(`version` は単調増加) https://developers.google.com/workspace/drive/api/reference/rest/v3/files
- [about]: 「Method: about.get」 https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get
- [uploads]: 「Upload file data」 https://developers.google.com/workspace/drive/api/guides/manage-uploads
- [revisions]: 「Manage file revisions」 https://developers.google.com/workspace/drive/api/guides/manage-revisions
- [native]: 「OAuth 2.0 for iOS & Desktop Apps」 https://developers.google.com/identity/protocols/oauth2/native-app
- [oauth2]: 「Using OAuth 2.0 to Access Google APIs」(refresh token の期限と 100 本) https://developers.google.com/identity/protocols/oauth2
- [android-authz]: 「Authorize access to Google user data」(Android) https://developer.android.com/identity/authorization
- [audience]: Google Cloud ヘルプ「Manage App Audience」 https://support.google.com/cloud/answer/15549945
- [verification]: Google Cloud ヘルプ「OAuth App Verification Help Center」 https://support.google.com/cloud/answer/13463073
- [verification-req]: Google Cloud ヘルプ「Verification requirements」 https://support.google.com/cloud/answer/13464321

[limits]: https://developers.google.com/workspace/drive/api/guides/limits
[errors]: https://developers.google.com/workspace/drive/api/guides/handle-errors
[appdata]: https://developers.google.com/workspace/drive/api/guides/appdata
[props]: https://developers.google.com/workspace/drive/api/guides/properties
[search]: https://developers.google.com/workspace/drive/api/guides/ref-search-terms
[changes-guide]: https://developers.google.com/workspace/drive/api/guides/manage-changes
[changes-list]: https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/list
[files-list]: https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list
[about]: https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get
[uploads]: https://developers.google.com/workspace/drive/api/guides/manage-uploads
[revisions]: https://developers.google.com/workspace/drive/api/guides/manage-revisions
[native]: https://developers.google.com/identity/protocols/oauth2/native-app
[oauth2]: https://developers.google.com/identity/protocols/oauth2
[android-authz]: https://developer.android.com/identity/authorization
[audience]: https://support.google.com/cloud/answer/15549945
[verification]: https://support.google.com/cloud/answer/13463073
[verification-req]: https://support.google.com/cloud/answer/13464321

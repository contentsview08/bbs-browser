# OBB の PC・スマホ同期 端末側の設計

2026-11-07 時点の案。全体の設計は `docs/sync-design.md`、サーバーの安全性は `docs/sync-security.md`。ここは端末の中の作りだけを書く。

## 前提

- 対象は PC 版とスマホ版。Web(hono-bbs)は対象外。テキストだけ
- コードの根拠は 2026-11-07 に読んだもの。行番号はその時点の値
- `apps/android` は別の担当が変更中。書いた時点で次の変更が未コミットで入っている。`AppViewModel.kt` の行番号はこの変更の前の値で、ずれている

| 変更 | 確かめた状態 | この文書の前提 |
| --- | --- | --- |
| 移行 SQL の共有 | `assets/migrations` を消し、Gradle で `packages/logstore/migrations` を写す | 両方が同じ SQL を流す |
| 上げた画像の履歴を DB へ | `LogDb.addUpload`・`importUploads`・`removeUpload` | `uploads` 表 |
| 設定の名前と単位 | `SettingUnits.kt`・`LegacyBackup.kt`。NG の項目名も PC と同じになった | PC の名前と単位 |
| 名前 | `BACKUP_APP = "OBB"` | OBB |

## 1. 全体の層

```
画面
  │ 利用者の操作(名前の付いた操作)
拾い(UserOps) ──データの更新と sync_ops を 1 つのトランザクションで──┐
  │                                                              │
今のデータ(ログ DB・Prefs・settings 表)                        sync_ops
  ▲                                                              │
  │ 適用(内部の経路。sync_ops に積まない)                       ▼
アダプター ◀──── 同期の表(sync_records・sync_state) ◀── 同期エンジン ──▶ サーバー
                                                          │
                                              核(packages/sync・obb/sync)
```

| 層 | 役目 | 置き場所(案) |
| --- | --- | --- |
| 今のデータ | 画面が読むもの。作り替えない | `threads`・`favorite_*`・`post_history`・`uploads`・`settings`・Prefs |
| 拾い | 利用者の操作を記録する | `packages/logstore/src/userOps.ts`・`data/UserOps.kt` |
| 同期の表 | 同期の正。全レコードの最新の状態 | 移行 `018_sync.sql` |
| アダプター | 今のデータ ↔ ペイロードの変換 | `packages/sync/src/adapters/`・`obb/sync/adapters/` |
| エンジン | 順番・通信・再送 | `packages/sync/src/engine/`・`obb/sync/engine/` |
| 核 | 純粋な関数(暗号・マージ・HLC) | 実装済み |

### 同期の表が正

- 今のデータは、同期の表から計算した結果の写し
- 既読だけ計算が要る(`read_no` = `readPosition`)。ほかは項目の写し
- 同期を切っても、今のデータは消さない。手元のデータがいつも使える

### 核の入口を小さく保つ

言語は TypeScript(PC)と Kotlin(スマホ)で、共通テストで揃える。Rust の共有は採用しない。後から核だけを差し替えられるよう、次を守る。

- エンジンとアダプターが呼ぶ核の関数は、下の表の 23 個だけ
- 核は IO を持たない。DB・通信・時計・鍵保管に触らない(乱数はノンスと `generateDeviceId` だけが核の中)
- 値は `SyncPayload`(JSON にできる形)とバイト列だけで渡す。言語の特別な型を境界に出さない
- 共通テストは核の入口の単位で書く。差し替えても同じテストで確かめられる

| 用途 | 入口(`packages/sync/src`) |
| --- | --- |
| 鍵と ID | `deriveKeys`・`spaceId`・`recordId`・`normalizeBoardUrl` |
| 暗号 | `sealPayload`・`openRecords` |
| マージ | `mergePayloads`・`updateRecord`・`makeTombstone` |
| 順序 | `orderKeyBetween`・`compareOrdered` |
| 既読 | `recordRead`・`makeReset`・`resetFloor`・`readPosition` |
| 時計 | `hlcStamp`・`hlcObserve` |
| 全件の取り直し | `planRebase`・`planRecreate`(8 章) |
| tombstone の保持 | `settleRecord`・`isTombExpired` |
| 端末の ID | `generateDeviceId`・`checkDeviceId` |

`checkPayload` は `openRecords` の中で通るので、外から呼ばない。

### 同期の表のスキーマ

`packages/logstore/migrations/018_sync.sql` の案。`src-tauri/src/lib.rs` の `migrations()` にも登録する。

```sql
-- レコードの最新の状態。本文は payload(知らないフィールドも含むキーを並べた JSON)が正で、ほかの列は引くための写し
CREATE TABLE sync_records (
  record_id TEXT PRIMARY KEY,          -- 64 桁の 16 進
  kind TEXT NOT NULL,                  -- payload.kind。知らない種類もそのまま
  kind_tag TEXT NOT NULL,              -- 'h' | 's'
  schema_version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  hlc TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,  -- 暗号文の中の値。サーバーの平文の deleted は使わない
  version INTEGER NOT NULL DEFAULT 0,  -- サーバーで最後に見た version。0 は未同期
  pending INTEGER NOT NULL DEFAULT 0,  -- 未送信の印
  priority INTEGER NOT NULL DEFAULT 5, -- 送る順。小さいほど先
  needs_apply INTEGER NOT NULL DEFAULT 0, -- 今のデータへまだ写していない
  ref_board TEXT,                      -- 正規化した板 URL(normalizeBoardUrl)
  ref_thread TEXT,                     -- スレのキー
  ref_detail TEXT,                     -- 端末 ID・post_id・NG の id・設定の名前など
  ref_local INTEGER,                   -- post_history.id のような手元の行
  tomb_at INTEGER                      -- この端末で tombstone になった時刻(ms)。90 日保持の起点
) WITHOUT ROWID;
CREATE INDEX sync_records_thread ON sync_records (kind, ref_board, ref_thread);
CREATE INDEX sync_records_pending ON sync_records (priority, hlc) WHERE pending = 1;
CREATE INDEX sync_records_apply ON sync_records (kind) WHERE needs_apply = 1;

-- 利用者の操作の記録。データの更新と同じトランザクションで積む。エンジンだけが消す
CREATE TABLE sync_ops (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  op TEXT NOT NULL,        -- 'favorite_thread_add' など
  target TEXT NOT NULL,    -- 同じものをまとめる鍵(既読はスレ)。まとめないものは seq ごとに別の値
  num INTEGER,             -- 既読の位置
  args TEXT,               -- JSON
  at_ms INTEGER NOT NULL
);
-- 既読は同じスレを 1 行にまとめる。スクロールのたびに行を増やさない
CREATE UNIQUE INDEX sync_ops_read ON sync_ops (op, target) WHERE op = 'read';

-- 同期の状態(1 項目 1 行)。秘密は置かない。settings 表に入れない(書き出しに混ざるので)
CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;

-- URL の揺れを吸収するとき、スレをキーで引く
CREATE INDEX threads_key ON threads (key);
```

`sync_state` の項目は次のとおり。

| 項目 | 中身 |
| --- | --- |
| `enabled` | 領域に入っている(鍵がある) |
| `master` | 同期自体のスイッチ。`0` で切る。ないときは `enabled` に従う |
| `device_id` | `[A-Za-z0-9_-]` 22 文字(16 バイトのランダム) |
| `clock` | 端末の HLC |
| `since`・`epoch`・`gc_floor` | サーバーの位置 |
| `kinds` | 種類ごとのオン・オフ(JSON)。既定と違うものだけ。端末ごとの設定で、同期の許可リストに入れない |
| `kinds_resume` | オンに戻して、まだ追いついていない種類 |
| `secret_refetch` | 権限系を読み直す時刻(ms)。切っている間に読み飛ばした分 |
| `phase`・`seed_cursor` | 初回の同期の進み具合 |
| `push_inflight` | 送信中の `request_id` と `record_id` の一覧 |
| `engine_lease` | エンジンの持ち主と期限 |
| `last_pull_at`・`last_push_at`・`last_error` | 画面に出す値 |
| `bad_counts` | 開けなかったレコードの理由ごとの数 |
| `pending_confirm` | 確認待ちの計画(`type` が `join` か `rebase`、`lost` など) |
| `phase_before` | `blocked` の前の `phase`。手動の同期でそこへ戻す |
| `recreate_pending` | 作り直しの全件の読み取りがまだ。`since = 0` のまま次の周で読み直す |
| `recreate_tried_at` | `recreate_waiting` で最後に作成を試した時刻 |
| `rebase_log` | リベースと作り直しの時刻(1 日 3 回の制限) |
| `rebase_accepted` | 確認で消してよいと答えた件数。読み直して増えていたらもう一度聞く |
| `rebase_backup` | リベースで消える項目の一覧 |

値はすべて文字列で持つ。PC のプラグインは数を f64 で束ねるので、TEXT の列に数を渡すと `1.0` の形になる。

`K` はこの表にも `settings` にも置かない(8 章)。

## 2. 更新の入口の一覧

分類は次の 3 つ。

- **同期:** 利用者の操作として記録する
- **同期しない:** 利用者の操作でも送らないもの、自動の整理
- **内部:** 取得のキャッシュや、画面の操作でないもの

件数は関数 66 個(PC 29・スマホの `LogDb` 21・`Prefs` の関数と書き込みの口 15・DB の入れ替え 1)、DB と `Prefs` の関数の呼び出し元 94 か所(PC 43・スマホ 51)。

| 場所 | 同期 | 同期しない | 内部 |
| --- | --- | --- | --- |
| PC の `LogStore` | 13 | 10 | 6 |
| スマホの `LogDb` | 12 | 6 | 3 |
| スマホの `Prefs` | 6 | 7 | 2 |
| 合計 | 31 | 23 | 11 |

残りの 1 つは DB の入れ替えで、8 章で扱う。

### PC: `packages/logstore/src/index.ts`(29 個)

呼び出し元は `apps/desktop/src`。**太字**は同じ関数が別の性質の経路から呼ばれるもの。

| 関数 | 呼び出し元 | 分類 |
| --- | --- | --- |
| `addSite` | **`App.addSite`(2182)は操作。`presets.ts:25` は自動** | 操作だけ同期 |
| `removeSite` | `App.removeSite`(2189)・`ToolWindow`(92) | 同期 |
| `replaceBoards` | `App`(588) | 内部 |
| `addFavorite` | **`toggleFavorite`(2166)・`addFavoriteUrl`(2172)は操作。`presets.ts:34` は自動** | 操作だけ同期 |
| `renameFavorite` | `App`(2121)。板の情報を取ったとき自動 | 内部 |
| `reorderFavorites` | `App`(868)・`ToolWindow`(85) | 同期 |
| `removeFavorite` | `App`(2166・2463)・`ToolWindow`(79) | 同期 |
| `addUpload` | `App.uploaded`(2290) | 同期 |
| `removeUpload` | `App`(2850) | 同期 |
| `setFavicon` | `host/favicon.ts:64` | 内部 |
| `setOgp` | `host/ogp.ts:106` | 内部 |
| `pruneOgp` | `host/ogp.ts:26` | 内部 |
| `setSetting` | **`useSettings.flush`(`ui/settings.ts:983`)は操作と自動が混ざる。同 937 は移行で自動** | 許可リストの項目だけ同期(下記) |
| `saveFetch` | `App.fetchThread`(1079) | 内部 |
| `deleteThread` | **`confirmDeleteLogs`(1282)は操作で、既読のリセットを送る。`pruneLogs` の中からも呼ばれ、そちらは自動で送らない** | 操作のみ同期 |
| `pruneLogs` | `App.pruneLogs`(2051)。起動後の自動と、設定の「今すぐ」(RPC) | 同期しない |
| `markRead` | `App.markRead`(2153)。`useThreadScroll`(598)から | 同期(`read` と `last_view`) |
| `addOwnPost`・`removeOwnPost` | `UserOps.ownAdd`・`ownRemove` から。書き込みの後(`afterPost`・`afterThread`)と、手の印(`markOwn`) | 同期(`own_post`) |
| `addFavoriteThread`・`removeFavoriteThread` | `toggleFavoriteThread`(918) | 同期 |
| `setDraft` | `App.saveDraft`(2349) | 同期しない |
| `setTrollMark`・`removeTrollMark` | `markTroll`(891) | 同期しない |
| `setAccount`・`deleteAccount` | `useAccounts`(41・49・55)・`ToolWindow`(99・105) | 同期しない(パスワード) |
| `backupTo` | `host/backup.ts:28` | 同期しない(下記) |
| `addPostHistory` | `App`(1728・1783) | 同期 |
| `deletePostHistory` | `App`(850) | 同期 |

別の経路が 1 つある。`schedule_db_restore`(`src-tauri/src/lib.rs:497`)は DB を丸ごと入れ替える。8 章で扱う。

### スマホ: `data/LogDb.kt`(21 個)

呼び出し元は `AppViewModel.kt`。

| 関数 | 呼び出し元 | 分類 |
| --- | --- | --- |
| `setFavorite` | **`toggleFavorite`(646)と `importBackup`(610)は操作。`applyPresets`(531)は自動** | 操作だけ同期 |
| `reorderFavorites` | `moveFavorite`(575) | 同期 |
| `addSite`・`removeSite` | **`addSite`(551)・`removeSite`(563)・`importBackup`(612)は操作。`applyPresets`(521)は自動** | 操作だけ同期 |
| `replaceBoards` | 551 の次(552)・`loadBoards`(632) | 内部 |
| `saveFetch` | `refreshThread`(739) | 内部 |
| `markRead` | `markRead`(916)。`ThreadScreen:904` から | 同期(`read` と `last_view`) |
| `touch` | **開いたとき(721)と、初めて取った後(740)** | 同期(`last_view`) |
| `OwnPostSql`(`UserOps.ownAdd`・`setOwnPosts`) | 書き込みの後(`send`)と、手の印(`markOwn`) | 同期(`own_post`) |
| `saveDraft` | 1228・1232・1280 | 同期しない |
| `setFavoriteThread` | `toggleFavoriteThread`(951・985)・`importBackup`(611) | 同期 |
| `addPostHistory` | `send`(1298) | 同期 |
| `deletePostHistory` | `deletePostHistory`(357) | 同期 |
| `addUpload` | `AppViewModel`(変更中の 1098)。上げたとき・貼り付け・同じ画像の再利用 | 同期 |
| `importUploads` | `importBackup`(変更中の 616) | 同期(操作) |
| `removeUpload` | `AppViewModel`(変更中の 1105) | 同期 |
| `deleteThread`・`deleteThreads` | `deleteLogOf`(960)・`deleteLog`(1065)・`deleteLogsOf`(971) | 既読のリセットを送る |
| `pruneLogs` | **起動時(1381)と `pruneLogsNow`(276)。どちらも整理** | 同期しない |
| `setFavicon` | `data/Favicon.kt:51` | 内部 |

スマホのスレ立ては `createThread`(1340 付近)で `addPostHistory` を呼ばない。PC は呼ぶ(1783)。スマホで立てたスレは書き込み履歴に入らないので、同期にも乗らない(U5)。

`Crawler.kt` と `CrawlWorker` は読むだけで、ログ DB に書かない(`crawl` の Prefs だけ書く)。

### スマホ: `data/Prefs.kt`(15 個)

| 口 | 呼び出し元 | 分類 |
| --- | --- | --- |
| `Pref.setValue`(`by pref` 77 項目。`wordsPref` を含まない) | 画面の代入。`ui/Settings.kt`・`ui/Chrome.kt` ほか | 許可リストの項目だけ同期 |
| `lastBoardUrl`・`lastBoardName` の setter | `openBoard`(661・662) | 内部 |
| `addRecentBoard` | `openBoard`(663) | 同期しない |
| `setNewThreadDraft` | `ReplySheet:429`・1347 | 同期しない |
| `setBoardVisit` | `refreshBoard`(681) | 同期しない |
| `setGesture`・`resetGestures` | `Settings:442・446` | 同期しない(端末ごと) |
| `addNg` | `addNg`(853)・`saveNg`(865) | 同期 |
| `removeNg` | `removeNg`(859) | 同期 |
| `setNg` | `setNg`(870)。`Settings:586` の「期限の切れた N 件を片づける」 | 同期(期限切れは除く) |
| `setAiRules`・`setAiOverrides` | `AiNgSettings`・`markAi`(837) | 同期しない(U6) |
| `setBoardMeta` | `SettingParts:192` | `alias` 等だけ同期(4 章) |
| `import` | `importBackup`(609) | 許可リストの差分を同期 |

`init` の中の値の読み替えは `sp.edit()` を直接呼ぶので `Pref.setValue` を通らない。内部のまま。

### 表にない保存先

いずれも同期しない。

| 保存先 | 中身 |
| --- | --- |
| Prefs `positions`(`AppViewModel:286`) | 読んでいた画面の位置 |
| Prefs `crawl`(`Crawler.kt`) | 定期確認の控え |
| `localStorage`(`draftStash`・`useDialogRect`・`useMediaInput`) | 書きかけ・窓の位置など |
| `post-cookies.json` | Cookie |

### 操作と自動が混ざるもの

| 関数 | 操作 | 自動 | 分け方 |
| --- | --- | --- | --- |
| `addFavorite`・`setFavorite` | 利用者が足す | `applyPresets` | `applyPresets` は `store` を直接呼び、`UserOps` を通さない |
| `deleteThread` | ログの削除(既読のリセットを送る) | `pruneLogs`(送らない) | 入口を分ける |
| `setSetting` | 画面の変更 | 起動時の移行(937)、`lastLogPruneAt` など | 許可リストで分ける |
| `setSetting('ngRules')` | NG の追加・削除 | 期限切れの片づけ(`App.tsx:2131`) | 差分の計算で期限切れを除く(下記) |
| `markRead` | 読んだ | タブの復元で画面に出たレスも進む | 位置が増えたときだけ呼ばれる(598)。読んだとして扱う |
| `touch` | 開いた | 取得の後の 740 | 開いた流れなのでどちらも操作 |
| `ownAdd` | 書き込みの結果と手の印 | なし | どちらも同じ操作として積む(`own_add`) |

### 設計書とコードの違い

| 設計書 | コード | この文書の決め方 |
| --- | --- | --- |
| 「履歴から外す」は tombstone、ログの削除は送らない | **「履歴から外す」操作はない**。閲覧履歴は `threads WHERE read_at IS NOT NULL` で、外すにはログの削除しかない | 「履歴から外す」を新しく足す(`read_at` を NULL にする。ログは残す)。今の「ログを削除」は送らない |
| 「未読に戻す」でリセットを書く | **別の操作は作らない。ログの削除が未読に戻す操作を兼ねる**。`markRead` は `MAX` で下がらず、下げる関数がない | ログの削除でリセットを書く。適用の経路に下げる関数を足す |
| `post_id` はランダム | 種まきでランダムにすると、やり直しで重複する | 決定的に作る(4 章) |
| ログの削除は全端末で削除 | ログを消すと `read_no` も `threads` の行ごと消える | リセットを送る。他の端末も、リセットより後に読んでいなければログと履歴の行を消す(消した端末と同じ見え方)。後に読んでいればその位置で残る。書き込み履歴は消さない |
| 既読はスレを閉じたときに 1 回 | `markRead` はスクロールで何度も呼ばれ、閉じる処理は `readFlush` だけ | 操作はまとめて積み、エンジンの周期で 1 回の記録にする(3 章) |

### PC の複数の窓

`ToolWindow` は自分で `openLogStore()` を呼び、同じ DB に書く。Rust 側のプールは 1 つ。

| 窓 | 書くもの | 同期での扱い |
| --- | --- | --- |
| main | 全部 | エンジンはここだけ |
| settings | `setSetting`、`removeFavorite`・`reorderFavorites`・`removeSite`・`setAccount`・`deleteAccount` を直接。`toggleFavorite`・`addFavoriteUrl`・`addSite`・`pruneLogs` は `callMain` | `UserOps` で `sync_ops` に積むだけ |
| ng | `update('ngRules', …)` → `setSetting` | 同じ |

- 窓の中に HLC を持たない。積む時点では時刻だけ記録し、HLC はエンジンが振る。これで 2 つの窓が同じ HLC を作らない
- `ngRules` は配列まるごとの書き込みなので、古い配列を持つ窓の保存で別の窓の追加が消えることがある。今も起きる問題だが、同期では tombstone になって全端末へ広がる。そのため `update` の時点で前の値との差分を作り、差分だけを積む(差分に出ない要素は tombstone にならない)
- `main` を閉じている間に残った窓が積んだ操作は、次の起動で処理する
- `tauri-plugin-single-instance` は入っていない。アプリを 2 つ起動できるので、`engine_lease` で 1 つだけが動く(8 章)

## 3. 拾い方

### 入口

`LogStore` の関数はそのまま「内部の書き込み」として残す。利用者の操作には名前の付いた関数を足し、画面はそちらを呼ぶ。

```ts
class UserOps {
  constructor(private store: LogStore, private db: SqlDb, private isOn: () => Promise<boolean>) {}
  async favoriteThreadAdd(t: ThreadSummary) { /* 更新の文と sync_ops の文を batch で流す */ }
}
```

| 操作 | `op` | `target` |
| --- | --- | --- |
| スレを読んだ | `read` | 板 + キー |
| スレを開いた(スマホの `touch`) | `view` | 板 + キー |
| 履歴から外す | `view_remove` | 板 + キー |
| お気に入りのスレ・板を足す・外す | `favorite_thread_add` など | 板 + キー |
| お気に入り板を並べ替える | `favorite_board_order`(`args.urls` に新しい並び) | 固定 |
| サイトを足す・外す | `site_add`・`site_remove` | メニューの URL |
| 書き込みをした・履歴から消す | `post_add`・`post_remove` | seq |
| 自分のレスの印を付けた・外した | `own_add`・`own_remove` | 板 + キー + 番号 |
| 画像を上げた・履歴から消す | `upload_add`・`upload_remove` | URL |
| NG を変えた | `ng_diff`(要素ごと。`args` に `id` と本文。消すときの本文は null) | `rule.id` |
| 設定を変えた | `setting` | 設定の名前 |

- `sync_ops` には手元の識別だけを書く。スレタイなどはエンジンが処理するときに今のデータから読む
- 同期を使っていないときは積まない。使い始めの種まきで全部入る
- 検査: `apps/desktop/src` と `AppViewModel` が同期の対象の関数を直接呼んでいないことをテストで確かめる(`applyPresets` だけ例外)。呼び出しの一覧を固定する

### 同じトランザクションにする

| 端末 | 方法 |
| --- | --- |
| スマホ | `db.beginTransaction()`。`LogDb` の既存の書き方 |
| PC | **`tauri-plugin-sql` は接続プールで、JS から `BEGIN` が同じ接続に届く保証がない**(`CLAUDE.md`)。Rust の命令 `sql_batch(statements)` を足す |

`sql_batch` の作り。

- `tauri_plugin_sql::DbInstances` と `DbPool::sqlite()` は公開されている(2.6.0 で確認)。`pool.begin()` で 1 つの接続のトランザクションにできる
- `SqlDb` に `batch(statements)` を足す。テストの sql.js は `BEGIN`・`COMMIT` で同じ動きにする
- 値の型の変換は `tauri-plugin-sql` の `wrapper.rs` と同じ規則にする。数は f64 になるので、INTEGER の列は整数に戻り、TEXT の列には文字列を渡す
- 同期が無効の間は `sql_batch` を呼ばない。`UserOps` は `sync_state.enabled` が読めないときも無効として扱い、今の関数をそのまま呼ぶ
- `CLAUDE.md` の「トランザクションに頼らない」は `execute` の話。`sql_batch` を足したら文を直す

読む文は入れない。`sync_ops` への INSERT は読みを要らないので、バッチで足りる。

### 積むときの注意

| 場面 | 決まり |
| --- | --- |
| 既読 | 同じバッチで `UPDATE sync_ops SET num = MAX(num, ?), at_ms = ? WHERE op = 'read' AND target = ?` と `INSERT OR IGNORE` を流す。スクロールで行が増えない |
| SQL の書き方 | `ON CONFLICT … DO UPDATE` を使わない。スマホの minSdk 26 の SQLite は 3.18 で、3.24 より前は通らない(API 30 から 3.28)。エミュレーターの新しい版では気づけないので、テストで文を検査する |
| PC の設定 | `useSettings.update` は 400ms 待って書く。同じ `flush` の中で `setSetting` と `sync_ops` をバッチにする |
| スマホの設定 | `Pref.setValue` は画面のスレッドで呼ばれ、スライダーで連続する。項目が許可リストにあるときだけメモリの列に入れ、400ms 後に裏で `sync_ops` に積む。SharedPreferences と DB は同じトランザクションにできないので、落ちると最後の変更を送らないことがある。次の起動の照合で直す(下記) |
| スマホの NG | 画面のスレッドで Prefs を変え、差分を直列の裏のキューで積む(DB を画面のスレッドで待たない。順は操作のとおり)。積む前に落ちた分は起動時の照合で埋める |

### 適用は別の経路

- 適用は `LogStore` の関数も `UserOps` も呼ばない。`applyBatch` の SQL を直接流す
- `sync_ops` に触らない。送り返さない
- スマホの設定は `Prefs.applyRemote(key, value)` を足す。`Pref` の状態を変えるが、メモリの列に入れない
- PC の設定は `applyRemoteSettings(patch)` を足す。`setSettings` と `settings-changed` だけを行い、`pendingWrites` に入れない

### 処理の順

エンジンが 1 周するたび、まず `sync_ops` を前から処理する。

1. `op` ごとにアダプターが今のデータを読み、`updateRecord` などで新しいペイロードを作る
2. HLC は `hlcStamp(clock, at_ms, device, record.hlc)` で振る(`at_ms` を時刻に使う)
3. `sync_records` の更新(`pending = 1`)・`clock` の更新・`sync_ops` の削除を 1 つのバッチにする

`read` の場合は `recordRead` を 1 回呼ぶ。周期ごとに 1 回なので `steps` の消費は少ない。`view` と合わせて `last_view` を更新する。

### 入れ違いの扱い

適用と利用者の操作は別々に DB へ書くので、順番が前後することがある。後の操作が勝ち、手元も揃うように次を守る。

- `sync_ops` を処理したレコードには `needs_apply = 1` を立て、周の中で写し直す。適用が書いた行を、次の周で操作の結果へ戻せる
- 適用は、まだ処理していない操作のあるレコードを飛ばし、次の周へ回す(`needs_apply` を残す)

### 起動時の照合

取りこぼしの保険。お気に入り板・お気に入りのスレ・NG・許可リストの設定は件数が少ないので、起動して同期の前に比べる。サイトと上げた画像は対象にしない(`reconciles = false`)。プリセットの板が版の更新で増えたときは、積まずにここで低い HLC のレコードになる。順序のレコードは毎回写し直して並びを確かめる。

| 状態 | 動き |
| --- | --- |
| 手元にあり、レコードがない | 種まきと同じ低い HLC でレコードを作る(新しい削除には勝たない) |
| レコードがあり、手元にない | 同期の表が正なので手元に戻す |
| tombstone があり、手元にある | 同期の表が正なので手元から消す。`trim` の tombstone は消さない |
| 値が違う | 同期の表の値を手元に写す |

レコードのあるものを手元の値で作り直さない。適用で足した行の `added_at` は適用の時刻なので、まだ届いていない削除に勝ってしまう。手元の値とマージするのは合流のときだけにする。

閲覧履歴と書き込み履歴は対象にしない(手元で消えているのが正しいことがある)。手元にある行の補いは次の項で行う。

### 手元にあってレコードのない行の補い

種まきは合流の 1 回だけなので、種まきのあとに足された種類(版の更新)や、DB を戻して増えた行にレコードができない。起動後の最初の周と、手動の同期のたびに `fill` で補う。

| 種類 | 補うもの |
| --- | --- |
| `last_view` | `read_at` のある行のうち、レコードのないもの |
| `post` | 手元の行のうち、レコードのないもの |
| `own_post` | `own_posts` の全行のうち、レコードのないもの |
| `ng`・`setting` | `seed` と同じ(種類を足す前に合流した端末の既存の NG と設定を送る) |
| `read_dev` | 手元の `read_no` が表の `readPosition` より大きいスレで、外した記録のないもの |

- HLC は種まきと同じ元の時刻。新しい削除に勝たない
- レコードがあれば(tombstone と `trim` を含む)作らない。消したものは戻らない
- リセットのあるスレでは作らない。手元の方が大きいのはリセットの前の値なので、写し直して下げる。リセットのあとの読みは操作で記録される

## 4. アダプター

### 種類の一覧と ID

`recordIdInput` の形。`board` は `normalizeBoardUrl` の値。

| データ | `kind` | ID の入力 | タグ |
| --- | --- | --- | --- |
| お気に入りのスレ | `favorite` | `favorite:<board>:<key>` | h |
| お気に入り板 | `favorite` | `favorite:<board>:` | h |
| 並び順 | `order` | `order:<board>:<key>`(板はキーなし) | h |
| 閲覧履歴 | `last_view` | `last_view:<board>:<key>` | h |
| 既読のリセット | `read_reset` | `read_reset:<board>:<key>` | h |
| 既読の記録 | `read_dev` | `read_dev:<board>:<key>:<device_id>` | h |
| 書き込み履歴 | `post` | `post:<board>:<key>:<post_id>` | h |
| 自分のレスの印 | `own_post` | `own_post:<board>:<key>:<no>` | h |
| サイト | `site` | `site:::<normalizeBoardUrl(menu_url)>` | h |
| 上げた画像 | `image` | `image:::<url>` | h |
| NG | `ng` | `ng:::<rule.id>` | h |
| 設定 | `setting` | `setting:::<name>` | h |
| 画像の削除ページ | `secret` | `secret:::<url>` | s |

- `post_id` は `SHA-256(board|key|posted_at|body)` の先頭 32 桁。`board` は `normalizeBoardUrl` の値、`body` は**切った後の本文**(`fitPostBody`)。受け取った端末は切った本文しか持たないので、切る前で作ると、その端末が種まきをやり直したときに別の ID になる。種まきをやり直しても同じ ID になる
- 種類のオン・オフの単位は、設計書の表の行(閲覧履歴と既読は 1 つ)

### 本文の項目と上限(`schema.ts`・`SyncSchema.kt`・`sync-schema.json`)

`record_id` は片道の HMAC なので、受け取った端末は本文に書いてあるものしか分からない。どの種類も、ID の入力に使った値を本文に持つ。**太字**は必須(tombstone では要らない)。長さは UTF-16 の単位の文字数。

| 種類 | 項目 |
| --- | --- |
| `read_reset` | **`board_url`**・**`thread`**(1〜256)・**`id`**(64)・**`target_res`** |
| `read_dev` | **`board_url`**・**`thread`**(1〜256)・`base_reset_id`(64・null 可)・**`pos`**・**`steps`**(64 件) |
| `last_view` | **`board_url`**・**`thread`**(1〜256)・`title`(1024)・`board_name`(256)・`created_at`・**`last_viewed_at`** |
| `favorite` | **`board_url`**・`thread`(256。板はなし)・`title`(1024)・`board_name`(256)・`created_at` |
| `order` | **`board_url`**・`thread`(256。板はなしか空)・**`key`**(1024) |
| `post` | **`post_id`**(1〜64)・**`board_url`**・**`thread`**(1〜256)・`title`(1024)・`no`・**`body`**(4096)・**`posted_at`** |
| `own_post` | **`board_url`**・**`thread`**(1〜256)・**`no`**・`posted_at` |
| `image` | **`url`**・`file_name`(1024)・`size`・`uploaded_at` |
| `ng` | **`id`**(1〜128)・**`type`**(64)・**`value`**(4096)・`is_regex`・`enabled`・`expires_on`(10)・`board_url`・`board_name`(256)・`note`(1024)・`created_at` |
| `setting` | **`key`**(2176。板ごとの設定は板 URL を含む)・**`value`**(真偽・整数・4096 文字まで) |
| `site` | **`menu_url`**・`name`(256) |
| `secret` | **`url`**・**`value`**(4096) |

- URL は http と https だけ、2048 文字まで。`board_url` は手元の生の URL で、正規化した値ではない(開くときにそのまま使う)
- `trim: true` は tombstone の共通フィールド(本文の外)。手元を消さない外し方で、`deleted: true` のときだけ通す。書き直すと消える
- `recordRead`・`makeReset` は `ThreadRef`(`board_url`・`thread`)を引数に取り、本文に書く。ログを消した後でもリセットを書けるよう、手元の行に頼らない
- **暗号文の上限(16KB)は文字数の上限と別に効く。** 書き込みは日本語の本文 4096 文字とスレタイ 100 文字なら収まる。エスケープで膨らむ文字(制御文字は 6 バイト)や長い URL・スレタイが重なると `too_large` になるので、アダプターは本文を切って作り直す

### 既読

| 今のデータ | ペイロード | 向き |
| --- | --- | --- |
| `threads.read_no` | `read_dev.body.pos`・`steps`、`read_reset` | `read_no` は `readPosition` の結果。下げることもある |
| `markRead` の `no` | `recordRead` の `pos` | 手元 → レコード |
| ログの削除 | `read_reset.body.id`(ランダム)・`target_res`(0) | 手元 → レコード。`pruneLogs` は書かない |

ログの削除の量の決まり。リセットは容量超過でも外さないので、書く数を先に抑える。

| 項目 | 値 | 理由 |
| --- | --- | --- |
| 1 スレ | `read_reset` 1 件。レコードは増えない(2 回目からは同じ ID) | 1 件 528 バイト |
| 1 回の操作の上限 | 2,000 スレ(`RESET_BATCH_MAX`・`LOG_RESET_MAX`)。超えた分は手元からだけ消え、他の端末は既読のまま | 約 1MB。送るのに 20 回の要求 |
| 領域の総数の上限 | 5,000 件(`RESET_TOTAL_MAX`)。超えた新しいスレは書かず `bad_counts.local` に数える。すでにリセットのあるスレは更新できる | 約 2.6MB。容量 10MB の 4 分の 1 |
| `threads.board_url`・`key` | `board_url`・`thread` | 手元の値をそのまま書く |

適用で未処理の読み(`sync_ops` の `read`)があれば、その位置より下げない。次の周で操作が処理されて計算し直される。

### 閲覧履歴

| 今のデータ | `last_view.body` | 埋め方 |
| --- | --- | --- |
| `threads.read_at` | `last_viewed_at` | max |
| `threads.title` | `title` | 空なら今の手元の値を残す |
| なし | `board_name` | 送るとき `favorite_boards.name`、なければ `boards.name`、なければ省く |
| `threads.created_at` | `created_at` | 無ければ省く。受信で無ければ、10 桁の数字のキーから作る(`LogDb.postHistory` と同じ) |
| `threads.connector_id` | 送らない | 下記 |

- 消した後に届いた、それより前の閲覧では行を作らない(`read_reset` の HLC の壁時計 ≧ `last_viewed_at`)。消した端末の履歴が勝手に戻らないように
- 操作の処理のときに手元の行がなければ、`last_view` は変えない(読んだ直後にログを消した)。`read_dev` は記録する
- 種まきの `read_dev` は `read_no > 0` の行。`read_at` がなければ `fetched_at`、それもなければ壁時計 1
| `post_count`・`cursor`・`status`・`fetched_at` | 送らない | 取得で決まる |

### お気に入りのスレ・板と並び順

| 今のデータ | ペイロード | 埋め方 |
| --- | --- | --- |
| `favorite_threads.board_url`・`key` | `favorite.body.board_url`・`thread` | |
| `favorite_threads.title` | `title` | `threads.title` があればそちら(`listFavoriteThreads` と同じ) |
| `favorite_threads.created_at` | `created_at` | |
| `favorite_threads.added_at` | 送らない | 種まきの HLC に使う。受信は適用の時刻 |
| `favorite_boards.url` | `board_url`(`thread` なし) | |
| `favorite_boards.name` | `board_name` | 空は手元を残す |
| `sort` | `order.body.key` | 下記 |

順序の決まり。

- `sort` の整数は写し。適用では `compareOrdered` で並べて 0 から振り直す
- 並べ替えは、前後が変わらない最長の部分を残し、動いた項目だけ `orderKeyBetween` で新しいキーを作る。`reorderFavorites(urls)` の全件の `UPDATE` をそのまま全レコードにしない
- 足すときは末尾のキーの次
- 順序のレコードがない項目は、ある項目の後ろに板 URL の順で並べる(今の順だと端末で並びが違ったままになる)
- 板を外すときは順序のレコードも tombstone にする
- キーが 256 桁を超えたら、そのリストを一度振り直す(利用者の操作として送る)
- `favorite_threads` を並べ替える操作は今ない。足した順のキーだけ作る。段階 1 では順序のレコードを作らず、適用は末尾に足す(端末で並びが違うことがある)
- 受信で足す行のスレタイが空なら、キーを入れる(`title` は NOT NULL)
- 受け取る側の検査に落ちる行(長すぎるキーなど)は種まきで送らない。操作なら捨てて `bad_counts.local` に数える。手元の行は残す

### サイト

| 今のデータ | `site.body` | 埋め方 |
| --- | --- | --- |
| `sites.menu_url` | `menu_url` | ID は `normalizeBoardUrl` を通した値で作り、本文は生の値を書く |
| `sites.name` | `name` | 空は手元を残す |
| `sites.connector_id` | 送らない | スマホは `HonoBbs.isSiteUrl`、PC は `canHandle` で決める |
| `sites.sort` | 送らない | 並べ替える操作がない。受信は末尾に足す |

- プリセットの自動の追加(`presets.ts`・`applyPresets`)は送らない。種まきでは手元の全部のサイトをレコードにする
- 受信で足したサイトの板一覧は、次に開いたときの既存の取得に任せる。適用では掲示板へ通信しない
- tombstone は `sites` の行と `boards` の行を消す。お気に入りの板は消さない

### `connector_id` は同期しない

スマホの `connectorOf` はしたらばとまちBBS も `2ch-compat` で入れる。PC は別の ID。値をそのまま送ると、PC で間違ったコネクタが選ばれる。

- PC: 適用の時に `allConnectors().find(c => c.canHandle(board_url))`
- スマホ: `connectorOf(board_url)`
- 扱えないもの(スマホのふたばなど)は同期の表にだけ持つ

### 書き込み履歴

| 今のデータ | `post.body` | 埋め方 |
| --- | --- | --- |
| `id` | 送らない | 手元の行は `posted_at` で引いて `post_id` で比べる(本文の揺れと URL の揺れを同じ規則で吸収する) |
| なし | `post_id` | 上の式 |
| `board_url`・`key` | `board_url`・`thread` | |
| `thread_title` | `title` | |
| `no` | `no` | NULL は省く |
| `body` | `body` | `fitPostBody` で切る。4096 文字か、JSON にして 12,288 バイト(制御文字は 6 バイト)の早い方。文字の途中で切らない。送った端末の行は切らずに残す |
| `name`・`mail` | 送らない | 受信は `''`。トリップを送らないため |
| `posted_at` | `posted_at` | |
| `connector_id` | 送らない | 上と同じ |

- 自分のレスの印は `post` からは作らない(`own_post` で別に届く)。tombstone でも `own_posts` は消さない
- tombstone の本文は `post_id` と `posted_at` だけ。手元の行を探すのに要る。本文とスレタイは残さない
- 消す操作の `args` には ID を作る値を書く(消した後は行がない)。次の周で消える
- 同じ `post_id` の行が手元に 2 つあれば、適用で 1 つにする
- 全部で平文 15,000 バイトを超えるときはスレタイを落とす
- スマホの `deletePostHistory` は `board_url`・`key`・`posted_at` で消す。`PostHistoryEntry` に `id` がないので足す

### 自分のレスの印

| 今のデータ | `own_post.body` | 埋め方 |
| --- | --- | --- |
| `own_posts.board_url`・`key` | `board_url`・`thread` | |
| `no` | `no` | ID にも使う(`ref_detail`) |
| `posted_at` | `posted_at` | 受信で無ければ適用の時刻 |

- 書き込みで付いた印も手で付けた印も同じレコード。外す操作は tombstone で、全端末から外れる(書き込み履歴の行は残る)
- 適用は `INSERT OR IGNORE`。`threads` の行がなくても入れる(印はログと独立。ログを消しても残る)
- 種まきと `fill` は `own_posts` の全行。HLC は `posted_at`
- 種類のスイッチは書き込み履歴と同じ(`posts`)

### 上げた画像

| 今のデータ | ペイロード | 埋め方 |
| --- | --- | --- |
| `url` | `image.body.url` | ID にも使う |
| `name` | `file_name` | |
| `size` | `size` | 受信で無ければ 0 |
| `uploaded_at` | `uploaded_at` | |
| `with_account` | 送らない | 受信は 0(その端末のアカウントで消せるとは限らない) |
| `hash` | 送らない | 手元の値を消さない |
| `delete_url` | `secret.body.value`(権限系) | 権限系がオンのときだけ |

適用は `INSERT OR REPLACE` を使わない(`hash` が消える)。同じバッチで `UPDATE` と `INSERT OR IGNORE` を流す。

### NG

`settings.ngRules`(PC)と `ngRules`(スマホ)の配列の 1 要素が 1 レコード。

| `NgRule`(PC・スマホ共通) | `ng.body` |
| --- | --- |
| `id` | `id`。ID の入力にも使う(受け取った端末が同じルールを編集できるように) |
| `target` | `type` |
| `pattern` | `value` |
| `isRegex`・`enabled` | `is_regex`・`enabled` |
| `expiresOnDate` | `expires_on` |
| `boardUrl`・`boardName` | `board_url`・`board_name` |
| `note` | `note` |
| `createdAt` | `created_at` |

- 同じ内容で別の `id` のものができる(`sameAs` は足すときだけ見る)。受信では消さない。見た目は設定の「重複」として数える
- 受信で式を検査する。読めないものと固まる形(`ngRiskyPattern`。表は `packages/conformance/ng-risky.json`)は適用せず、同期の表には残して `bad_counts.ng_rule` に数える。正規表現は途中で止められないので文字の上で見分ける。多項式の遅さは幅の広い繰り返し 3 回までを許す範囲で残る
- 手元に入れるのは 5,000 件まで(`NG_APPLY_MAX`)。超えた分は表にだけ持つ
- 差分は「その配列を作った窓が見ていた配列」と比べる(`update('ngRules', 新しい配列, もとにした配列)`・`ngDiff`)。読み込み直前の値とは比べない。保存は差分を今の DB の値に重ねるので、古い窓の配列が別の窓の追加を手元からも消さない
- 期限切れ: 差分で「消えた要素が期限切れ」なら送らない(`drop`)。自動の片づけも手で片づけるのも同じで、結果は全端末で同じになる。受信でも期限切れは手元に入れず、種まきでも送らない
- 読み込み(バックアップ・設定のファイル)で消えた要素も `drop`。消す操作ではないので全端末から消さない。レコードが残るので、次の起動の照合で手元に戻る
- 手元の置き場は `NgHost` の裏(PC は settings 表、スマホは Prefs)。適用は周の最後に 1 回書く
- 起動時の照合は値まで比べ、違えば表の値へ戻す

### 設定の許可リスト

許可リストは `packages/sync/settings-allowlist.json` に置き、PC とスマホが読む(スマホは Gradle が assets へ写す)。値はどちらの端末でも同じ意味のものだけを入れる。`never` は入れてはいけない項目で、テストで確かめる。既定値が端末で違う項目(`idShort`・`dateStyle`)は `default` を端末ごとに書く。

| 群 | 項目(PC の名前) | 値の形 |
| --- | --- | --- |
| 見張る言葉 | `keywords`・`grossWords` | 配列 → JSON の文字列 |
| レスの出し方 | `omitNoname`・`tidyBlankLines`・`urlShorten`・`highlightOp`・`idStyle`・`idShort`・`idPosition`・`dateStyle`・`watchoiShort`・`nameSubtle`・`iconFromWatchoi`・`groupNg`・`ngMode`・`heatStyle`・`blurGross` | 真偽・短い文字列 |
| 操作 | `openPosition`・`threadSort`・`unreadFirst`・`quickPhrases` | 真偽・文字列・JSON の文字列 |
| 板ごと | `boardMeta` の `alias`・`omitNoname`・`nonames`(`setting:::boardMeta/<板>`) | JSON の文字列 |

同期しないもの。

| 理由 | 項目 |
| --- | --- |
| 秘密 | `postName`・`postMail`・`postDeleteKey`・`catboxUserhash`・`imgbbApiKey`・`imgurClientId`・`postAccounts`・`honoUser`・`honoPassword`・`boardMeta` の `defaultName`・`defaultMail` |
| 端末ごと | 窓の幅と高さ・`openTabs`・`activeTab`・`lastBoardUrl`・`boardVisits`・`notificationLog`・`keymap`・`mouseGestures`・`swipeGestures`・`barLayout`・`backgroundImage`・`imageSaveDir`・`fontFamily`・`customFont`・字の大きさ・`scheme` と配色(U8) |
| 通信の量に関わる | `autoRefreshSec`・`favCheckMin`・`historyCheckMin`・`keywordWatchMin` |
| 大きい | `aiNgRules`・`aiNgOverrides` |

- `checkPayload` の `scalar` は真偽・整数・4096 文字までの文字列だけ。小数は通らない(行間などは同期しない)
- 受信の値は範囲を検査して丸める。知らない値は適用せず、同期の表には残す
- 既定と同じ値は種まきで送らない
- 領域に設定のレコードが 1 つでもあれば種まきしない(合流は領域の値を使う)。レコードのない項目は手元の値のまま
- 板ごとの設定の ID は `setting:::boardMeta/<正規化した板 URL>`、本文の `key` は生の URL
- 適用は周の最後に 1 回書く。手元の値が表と違えば起動時の照合で表の値へ戻す

### 手元の URL との対応

`threads.board_url` は生の URL で持つ。端末で `http`・`5ch.net` のように違うことがある。

- 手元の行を探すとき: `threads` をキーで引き(`threads_key`)、`normalizeBoardUrl` で比べる
- 新しい行を作るとき: PC は `canonicalBoardUrl`、スマホは同じ規則で直した URL を入れる
- 板が別のサーバーへ移ったとき(`eagle` → `mi` など)は別のレコードになる(12 章)

### 同期自体のスイッチ

既定はオフ(`master` がなく、`enabled` もない)。使っている端末は、`master` がなければオンのまま続ける。

| 場面 | 動き |
| --- | --- |
| オフ | 周を始めず、鍵保管も開かない。`/head` も呼ばない。操作を積まない |
| オフの間の同期の開始・参加 | 断る(`sync_off`)。画面にはボタンを出さない |
| オンに戻す | 周を回す。切っていた間の手元の行は下の「追いつき」で補う |
| この端末で同期をやめる | 鍵・同期の表と一緒に、`master`・`kinds` も消して既定へ戻す。権限系がオンのまま残らない |

### 種類のオン・オフ

単位と既定は `sync-ui.json` の `groups`(`engine/kinds.ts`・`SyncKinds.kt`)。権限系だけ既定でオフ。

オフの意味は「この端末では、その種類を積まず、送らず、手元へ写さない」。

| 場面 | 動き |
| --- | --- |
| オフにした | 新しい操作を `sync_ops` に積まない。切る前の操作と `pending` のレコードは残すが送らない。`push_inflight` の分も送らない |
| オフの間に受信した | `sync_records` にマージし `needs_apply = 1` のまま。`since` は進む。適用・照合・補い・リベースの手元の削除も通らない。開いたときの既読の戻し(`restoreThreadRead`)もしない |
| オフの間の容量超過 | その種類は `trim` しない |
| 再びオンにした | 下の「追いつき」 |
| サーバーのデータ | 消さない |

要約・不一致の検査は、切っている種類を手元の比較から除く。送信待ちの数にも入れない(自動の同期を起こさない)。「この種類をサーバーから外す」はまだ作っていない。

### 追いつき

オンに戻すと `kinds_resume` に種類を入れ、次の周で次を行う。

1. 今のデータから `seed` を作り、`mergePayloads` でレコードと合わせる。HLC は元の時刻なので、新しい削除には負け、切っていた間に増えた行や読み進めた分は勝って送られる
2. その種類の全レコードに `needs_apply = 1` を立てて写し直す。受信を残しているので `since` を戻さなくてよい

切っていた間の手元の削除は積んでいないので、同期の表の値へ戻る。設定も、レコードのある項目は表の値へ戻る。消したものを残したいなら、オンのまま消す。

切っている間にリベースで消えたレコードは手元を消さないので、オンに戻すと古い HLC のレコードとして作り直されることがある(90 日以上の長期オフラインと同じ制約)。

### 権限系

`secret` は画像の削除ページの URL(`uploads.delete_url`)。今のところ、これ以外の管理トークンを持つ機能はない。

| 決まり | 理由 |
| --- | --- |
| `kind_tag = 's'`。`k_secret` で封をする | 履歴系と鍵を分ける |
| 積む操作は `secret_put`・`secret_remove`。`args` は画像の URL だけで、値はエンジンが処理するときに読む | `sync_ops` に値を置かない |
| オフの端末は `kind_tag = 's'` のレコードを開かず読み飛ばす(version は数える) | 読むのはオンの端末だけ。壊れたものも数えない |
| オンにすると `secret_refetch` で `since = 0` から読み直す。全件の読み取りの制限で断られたら、権限系だけ後回しにしてほかの同期を止めない | 読み飛ばした分を保持しないため、サーバーから取り直す |
| オフにすると `secret` の行と `secret_*` の操作を消す。`uploads.delete_url` は消さない | 同期の表に平文を残さない。値は手元の行から作り直せる |
| `leave` と `rejoin` で既定のオフへ戻す | DB を別の端末へ入れても引き継がない |
| 手元への写しは周の最後(`afterApply`)に行う。`uploads` に行がない間は写さない | 画像より先に届く、画像の種類を切っている |

限界: オフの端末で画像の履歴を消しても `secret_remove` は積まないので、サーバーの暗号文は残る。

同期全体を切ったときは 8 章。

## 5. 適用

### 手順

適用は 2 段に分ける。受信と反映が別々に失敗しても、取りこぼさないため。

1. **受け取る:** `openRecords` で開き、`mergePayloads` で `sync_records` に入れる。変わったものだけ `needs_apply = 1`。`since` の更新と同じバッチ
2. **写す:** `needs_apply = 1` を 200 件ずつ読み、今のデータの更新と `needs_apply = 0` を 1 つのバッチにする

### 規則

| 種類 | 適用 |
| --- | --- |
| `read_*` の `trim` の tombstone | 計算し直さない。外した記録を除いて計算すると、手元の既読が下がるため |
| `read_*` | 同じスレの `read_reset` と全 `read_dev`(`sync_records_thread` で引く)から `readPosition` を計算し、`threads.read_no` に書く。リセットがなければ下げない(まだ送っていない手元の読みを残す)。行がなければ何もしない。リセットがあり、`readPosition` が 0 で、未処理の読みがなく、行の `read_at` がリセットの壁時計以前なら、`posts` と `threads` の行を消す(ログの削除を写す) |
| `last_view` | 行があれば `read_at`・`title` を更新。なければ下の表 |
| `last_view` tombstone | `read_at = NULL`。ログは消さない。`trim` なら何もしない |
| `favorite` | 足す・消す・名前の更新。並びは最後にまとめて振り直す |
| `site` | 足す・消す・名前の更新。`trim` なら何もしない |
| `order` | リストごとに `sort` を振り直す |
| `post` | `ref_local` がなければ INSERT。tombstone は行を消す。`trim` なら何もしない |
| `own_post` | `INSERT OR IGNORE`(スレの行がなくても)。tombstone は行を消す。`trim` なら何もしない |
| `image` | 上の `UPDATE` と `INSERT OR IGNORE`。tombstone は行を消す |
| `ng`・`setting` | 検査してから手元に書く |
| `secret` | `uploads.delete_url` |
| 知らない種類 | 同期の表にだけ持つ |

- `ref_*` は、一度分かったら消さない。tombstone は `body` を残さないので、ここから何のレコードかを知る
- `read_no` を下げられるのは、リセットのあるスレの適用だけ。`markRead` は `MAX` のまま

### 手元にログのないスレ

| 条件 | 動き |
| --- | --- |
| `last_view` があり、`read_at` が保持日数(`logRetentionDays`)より新しい | `threads` に空の行を作る(`post_count = 0`・`cursor = NULL`・`status = 'active'`・`read_no` は計算の値) |
| それより古い | 同期の表にだけ持つ。作ると次の `pruneLogs` で消えるだけ |
| 扱えない掲示板(スマホのふたばなど)・`isAutoLoadable` を通らない URL | 同期の表にだけ持つ |
| `read_*` だけ来た | 同期の表にだけ持つ |

空の行で確かめたこと。

- `loadThread` は `posts: []` で返る。次の取得は `cursor` が NULL なので全件になる
- PC の `fetchThread`(1075 付近)は同じ動き。`unreadFrom` は `read_no + 1` になる
- スマホの `openThread` は `log != null` で `page.loaded = true` になり、`setPosts(page, [])` が走る。一瞬「レスなし」の見た目にならないか実装で確かめる
- `favIncrease` は手元のレス数が 0 なら知らせない。入れた直後に通知がまとめて出ない
- `pruneLogs` の対象になる。削除の tombstone は出ない

### ログを消したスレをもう一度開く

ログの削除は全端末で削除にする。消した端末では行がなくなるので、他の端末も同じ見え方(履歴になく、一覧に未読の数が出ない)にそろえる。消した後に読んだ端末だけ、その位置で残る。

- 消した端末はリセットを書き、ログと履歴の行を消す。開き直すと先頭から始まる
- 他の端末は、消す前の閲覧しかなければログと履歴の行を消す(「規則」の `read_*`)。開いているタブ・画面も閉じる(下の「読んでいる最中」)。消した後に読んでいれば、既読を下げるだけで行は残る
- 覚えたスクロール位置(PC は閉じたときの位置 `closedPositions`、スマホは `positions`)も消す。手元の削除も、他の端末の削除が写ったときも同じ。開き直す位置は既読から決まり、既読が 0 なら先頭
- 書き込み履歴と自分のレスの印は消さない(印は `own_post` のレコードで別に持つ)
- 自動整理(`pruneLogs`)はリセットを書かない。開き直すと同期の表から既読が戻る

### 読んでいる最中

他の端末の削除が写って行が消えたスレは、開いていてもタブ・画面を閉じる(消した端末と同じ見え方)。PC は `syncedReads` で、読み込んであるのに行のないタブを「開き直す」の一覧に入れずに閉じる。スマホは `reflectSyncedReads` で `Page.Thread` を積み重ねから外す(見ている画面なら戻ると同じ動きで前の画面へ。「進む」にも残さない。知らせは出さない)。アダプターは画面で開いているかを見ない。

行が残るとき(消した後にこの端末で読んでいる。`sync_ops` の `read` が残っているときも)は、位置を動かさない。

| もの | 上がるとき | 下がるとき(リセット) |
| --- | --- | --- |
| DB の `read_no` | 書く | 書く |
| 開いているタブの `readNo`(PC)・`page.readNo`(スマホ) | 上げる | そのまま。閉じて開き直すと反映 |
| 「ここから未読」の線(`unreadFrom`) | 動かさない | 動かさない |
| スクロール位置 | 動かさない | 動かさない |
| `useThreadScroll` の `sent` | 触らない | 触らない |
| スレ一覧・履歴・お気に入りの未読の数 | 変える | 変える |

読み進めると `markRead` が `MAX(read_no, no)` で書く。リセットの後は小さい値なので上がる。`recordRead` が新しいリセットを引き継ぐ。

### 開いている画面への反映

適用の結果を要約にして、画面へ 1 回だけ渡す。

`CycleResult.applied` は変わった種類の集まり(キーはアダプターの `area`: `favoriteThreads`・`favoriteBoards`・`sites`・`uploads`・`ng`・`posts`・`ownPosts`)。閲覧履歴と既読を足すときに行ごとの要約を足す。

`ownPosts` が立ったら、開いているタブ・画面の `ownNos` を `own_posts` から読み直す(PC は `syncedOwnPosts`、スマホは `reflectSyncedOwnPosts`)。スレの更新(`fetchThread`・`refreshThread`)の後も読み直すので、適用と更新が前後しても揃う。


| 端末 | 反映の口 |
| --- | --- |
| PC main | `useSync` フック(`App.tsx` に足さない)。`reloadFavorites`・`reloadFavThreads`・`reloadRecent`、`setStates`・`setHistory`・`patchFav` と同じ形で `readNo` を写す |
| PC 道具の窓 | `favorites-changed` を出す。設定は `settings-changed` |
| スマホ | `withContext(Dispatchers.Main)` で `AppViewModel.onSyncApplied`。`reloadSide()`、`Page.Threads.states`、`allUnread`、`postHistory` |

周が重なったとき(走っている周に別のきっかけが来たとき)、`applied` は全部の周の和を渡す。

画面が DB を読み直す場面。適用の有無によらず同期された値を出す。

| 場面 | PC | スマホ |
| --- | --- | --- |
| 手動の同期のあと | `useSync` の `syncNow` | `reloadSyncedScreens` |
| 板の更新・開き直し | `openBoard`。取得の前後で `getThreadStates` | `refreshBoard`。取得の前後で `threadStates` |
| 履歴の画面を開く・更新 | `openHistory`・`refreshHistory` | `openPast`・`checkNew` |
| 周の適用のあと | `syncedReads`(履歴の一覧・サイドバーの最近のスレ・板の未読。行が消えたスレのタブを閉じる) | `reflectSyncedReads`(`history` を読む Drawer と履歴の画面・板の未読。行が消えたスレの画面を外す) |

- 板の未読は、行の URL の書き方(http・https、`5ch.net`・`5ch.io`)によらず読む(`boardUrlVariants`)。行は書いた端末の URL のまま残るため
- 履歴の一覧は両方 `HISTORY_SHOWN`(300 件)。PC の新着の確認は掲示板への要求を増やさないよう、先頭 100 件だけ

### 手元の件数が合わない理由

同期の要約の `notes`(文字列では `?名前=数`)。0 は出さない。文言は `sync-ui.json` の `notes`。

| 名前 | 意味 |
| --- | --- |
| `history_no_record` | 手元の履歴のうち、まだ同期の表にないもの。次の手動の同期で送る |
| `history_over_shown` | 履歴の画面の上限を超える分 |
| `view_old` | 保持日数より古いので、手元に入れていない履歴 |
| `view_unresolved` | この端末で開けない掲示板の履歴 |
| `view_reset` | ログの削除より前の閲覧なので、手元に入れていない履歴 |
| `view_other` | 手元にまだ入っていない履歴。ほかの理由に当たらないもの |
| `read_no_row` | 既読の記録だけがあり、手元に行のないスレ(履歴から外したスレなど)。そのスレの板の未読は相手と揃わない |
| `read_differs` | 手元の既読が同期の表と違うスレ |
| `ops_waiting` | まだ処理していない操作 |
| `bad_<理由>` | `bad_counts` の値。捨てた数と、適用に失敗した数(`bad_apply`) |

`threads` が 200 件を超えたら、行ごとに直さず一覧を読み直す。設定は `reapplyNg()`・`rerenderAll` が既存の流れで走る(スマホ)。PC は `settings` の変更で `postMatcher` が作り直される。

### 性能

| 項目 | 決まり |
| --- | --- |
| 1 回の適用 | 200 件 1 バッチ。間で 1 回画面に譲る(PC は `setTimeout(0)`、スマホは `yield()`) |
| 1 周の時間 | 2 秒を超えたら次の周へ回す。初回の同期のときは続ける |
| 画面のスレッド | スマホは全部 `Dispatchers.IO`。PC は DB が IPC 越しなので止まらないが、JSON の解析は小分けにする |
| 順序 | `sort` の振り直しは適用の最後に 1 回 |
| 既読の計算 | 周の中で同じスレは 1 回 |

### 失敗と巻き戻し

| 失敗 | 動き |
| --- | --- |
| バッチの途中 | トランザクションで全部戻る。`needs_apply` が残り、次の周でやり直す |
| 1 件の検査の失敗 | その件だけ `needs_apply = 0` にして数える。ほかを止めない |
| バッチが続けて 3 回失敗 | 1 件ずつに分けて原因のレコードを除ける |
| 適用の途中でアプリが落ちた | 次の起動で続ける |
| 受信の途中 | `since` はレコードと同じバッチで進むので、途中までは有効 |

## 6. 初回の同期

### 1 台目

エンジンが `seeding` の間、今のデータからレコードを作る。

| 順 | 種類 | 読むもの | HLC の壁時計 | `priority` |
| --- | --- | --- | --- | --- |
| 1 | お気に入り板・並び | `favorite_boards` | 1(時刻がない) | 1 |
| 2 | お気に入りのスレ・並び | `favorite_threads` | `added_at` | 1 |
| 3 | サイト | `sites` | 1(時刻がない) | 1 |
| 4 | NG | 設定 | `createdAt`。0 なら 1 | 2 |
| 5 | 設定 | 許可リストで既定と違うもの | 1 | 2 |
| 6 | 書き込み履歴 | `post_history`(新しい順) | `posted_at` | 3 |
| 6 | 自分のレスの印 | `own_posts`(新しい順) | `posted_at` | 3 |
| 7 | 上げた画像 | `uploads`(新しい順) | `uploaded_at` | 4 |
| 8 | 閲覧履歴・既読 | `threads WHERE read_at IS NOT NULL`(新しい順) | `read_at` | 5 |

### HLC の決め方

- `formatHlc(min(元の時刻, 今), 0, device_id)`。カウンターは 0
- **今の時刻を使わない。** 使うと古いデータが新しい削除に勝つ
- 時刻のないものは壁時計 1。どの削除にも負ける
- `clock` は種まきで進めない
- `read_dev` は `{ base_reset_id: null, pos: read_no, steps: [{ at: HLC, pos: read_no }] }`。リセットのある領域に合流すると、`at` がリセットより古いので候補にならない。古い読みが未読に戻す操作に勝たない

### 件数の多いとき

| 件数(レコード) | 動き |
| --- | --- |
| 1,000 まで | すぐ全部作り、画面は進み具合の線だけ |
| それ以上 | 500 件ずつ作り、間で画面に譲る。`seed_cursor` で途中から続けられる。使いながら進む |

送るのは `priority` の順に 100 件ずつ。20 回/分の上限で 2,000 件/分。1 万 5 千件で約 8 分。

- 送っている途中に新しい操作が来たら `priority = 0` で先に送る
- 種まき中の pull は行う(合流した別の端末の変更を先に受ける)

### 2 台目の合流

**先に全部受け取り、後で手元と合わせる。**

1. ペアリングで `K` を受け取る。新しい `device_id` を作る
2. `GET /changes?since=0` を最後まで読み、`sync_records` に入れる。まだ写さない
3. 今のデータから種まきと同じ値を作り、同じ ID があれば `mergePayloads`。合わせた結果がサーバーの値と違えば `pending = 1`
4. 手元で消えるもの・増えるものを数え、計画にする
5. 消えるものが 10 件以上か、お気に入りが半分以上減るなら確認を出す(数えるのは手元に行のあるレコードと、そのうち `trim` でない tombstone)。答えは `accept_removal`(進める)か `keep_local`(進まない。同期の表と鍵を消して使っていない状態へ戻す。手元は残る)
6. 写す。そのあと送る

1 台目も同じ流れを通る。`GET /changes?since=0` が 404 なら、許可証を付けて `POST /spaces` で作る。`epoch` をまだ持っていないので、合わせ直さない。`capacity_full`・`creation_closed` は `blocked`。許可証がなければ要求を送らず `blocked`(`ticket_required`)。

| データ | 合流の結果 |
| --- | --- |
| お気に入り | 和集合。領域の tombstone が手元の古い項目に勝つ |
| サイト | 和集合。領域の tombstone が手元の古い項目に勝つ |
| 並び順 | 領域の順が正。手元だけの項目は末尾に足す(新しいキー)。**種まきのキーで領域の順を崩さない** |
| 既読 | 2 台の max。`read_dev` が別なので自然に合う |
| 閲覧履歴 | `last_viewed_at` の max |
| 書き込み・画像・自分のレスの印 | 和集合 |
| NG | 和集合。同じ内容で `id` が違うものは両方残る |
| 設定 | 領域の値を使う。手元の値はレコードにしない。確認の画面で「この端末の設定を使う」を選べる(選ぶと新しい HLC で送る) |
| プリセットのお気に入り板 | 普通の項目と同じ。領域で消していれば消える |

### 容量を超えるとき

1 レコードの大きさの見積もりは次のとおり(平文が 256 バイト単位に埋まり、タグ 16 バイトが付く)。

| 種類 | 平文の見積もり | 暗号文 |
| --- | --- | --- |
| `read_dev` | 約 300 バイト(`steps` 1 件) | 528 バイト |
| `last_view` | 約 350 バイト(スレタイ 50 字) | 528 バイト |
| `favorite`・`order` | 約 300・200 バイト | 528・272 バイト |
| `post` | 本文による | 528〜 |

2 台で読むスレ 1 本は `last_view` 1 + `read_dev` 2 で約 1.6KB。**10MB は約 6,500 スレで埋まる。** 1 日 70 スレ読む人は、保持 90 日で届く。

優先順は次のとおり。種まきも普通の送信と同じ流れで、超えたら下の順に外す。

| 優先 | 種類 | 超えたとき |
| --- | --- | --- |
| 1 | お気に入り・並び・サイト・NG・設定 | 外さない |
| 2 | 書き込み履歴 | 古い順に外す |
| 3 | 上げた画像 | 古い順に外す |
| 4 | 閲覧履歴と既読 | 最初に外す。古いスレから `trim` |

413 を受けたら、優先の低い古いものから 100 件を外して再送する(1 周に 5 回まで)。まだ送っていないものは送らないだけ。送ったものは `trim` の tombstone にする(tombstone も容量を使うので、外す効果はサーバーの 90 日後の片づけまで遅れる)。`read_reset`・お気に入り・NG・設定は外さない。外せるものがなければ送信待ちのまま画面で知らせる。外した回数は `bad_counts.quota_trim`。

## 7. コネクタとの関係

- 同期はコネクタを通らない。掲示板へ通信しない
- `packages/sync` はコネクタに依存しない。アダプターの親(`apps/desktop`・`AppViewModel`)が `findConnector` 相当の関数を渡す

### 同期したスレを開く

レコードの `board_url`・`thread`・`title` で `ThreadSummary` を作る。URL の解析は要らない。

| 項目 | 値 |
| --- | --- |
| `boardUrl` | 手元に行があればその値、なければ `canonicalBoardUrl` を通した `board_url` |
| `key` | `thread` |
| `title` | レコードの値。空ならキー。開けばコネクタの結果で上書きされる |
| `connectorId` | PC は `canHandle`。スマホにはない |
| `createdAt` | `created_at` |

`resolveUrl`(通信がある)は使わない。

### スマホにない掲示板

スマホに `futaba` のコネクタはない。`connectorOf` は何でも `2ch-compat` を返す。

- `HonoBbs`・`Shitaraba`・`Machi`・`TwoCh` の判定に通らない板、ふたばのホストの板は `threads` と `favorite_*` に入れない
- レコードは持ち続ける。設定の同期の画面に「この端末で開けない項目 N 件」を出す
- 判定の表を `packages/conformance/sync-connector.json` に置き、PC とスマホが同じ URL を同じように見分けるか確かめる

PC の `loadHistory`(`App.tsx:316`)は `findConnector` で通らない行を隠すので、間違いがあっても壊れない。スマホは同じ保護がないので入口で止める。

### 板 URL の正規化の共有

| 関数 | 用途 | 場所 |
| --- | --- | --- |
| `normalizeBoardUrl` | 同一性(ID の入力)。元に戻せない形 | 核。`sync-id.json` |
| `to5chIo`・`canonicalBoardUrl` | 今の正しい URL | コネクタ |
| `boardKey`(`twoch/connector.ts:61`) | 文字コードの覚え | 同じ形だが別物 |

- 同期の中で URL の比較に使うのは `normalizeBoardUrl` だけ
- コネクタの `canonicalBoardUrl` が変わっても ID は変わらない。`normalizeBoardUrl` を変えると全 ID が変わる。**変えるなら `schema_version` を上げて全件を作り直す**
- 2 段のサブドメインなど、`to5chIo` と同じ規則のテストを `sync-id.json` に持つ。コネクタ側を変えるときに気づける

## 8. 同期エンジン

### 状態

```
off ─ペアリング→ joining ─計画→ (confirm) → seeding → idle
idle ─きっかけ→ draining → pulling → merging → applying → pushing → idle
```

| 状態 | 中身 |
| --- | --- |
| `off` | 使っていない |
| `joining` | 全件を受け取り、計画を作る |
| `confirm` | 利用者の判断を待つ。自動で進めない |
| `seeding` | 種まき。ほかの周と並行 |
| `idle` | 次のきっかけを待つ |
| `draining` | `sync_ops` を処理する |
| `pulling`・`merging` | `/changes` と `sync_records` |
| `applying` | 今のデータへ写す |
| `pushing` | `/records` |
| `backoff` | 再送の待ち |
| `offline` | 通信できない |
| `rebasing` | `planRebase` の実行 |
| `recreating` | 領域が消えたあとの全件の読み取りと `planRecreate` の実行 |
| `recreate_waiting` | 作り直したいが満員。前面に来るたび試す |
| `blocked` | 新規作成の満員・停止・認証失敗・許可証の問題。自動で再開しない |

周の順は必ず draining → pull → apply → push。push の前に受け取るのは、409 を減らすため。push の 409 のマージでサーバーの値が勝ったら、周の最後にもう一度 apply を通す。

`phase` に保存するのは `joining`・`seeding`・`confirm`・`idle`・`recreate_waiting`・`blocked`。ほかは周の中だけの状態で、再送の待ち(`backoff`・`offline`)はメモリに持つ。起動し直すとすぐ試せる。

### きっかけ

設計書の「タイミング」のとおり。実装の場所は次のとおり。

| きっかけ | PC | スマホ |
| --- | --- | --- |
| 前面に戻る | `focus`・`visibilitychange`(`useSync`) | `MainActivity.onStart`(`vm.appVisible`) |
| 放置後の操作 | `pointerdown`・`keydown` で最後の時刻を見る | 同じ考えを `Activity.onUserInteraction` で |
| ネットワークの復帰 | `online` | `ConnectivityManager.NetworkCallback`(前面の間だけ登録) |
| 確認(1 分〜5 分) | 前面のときだけ `GET /head`。`SyncScheduler` | 同じ |
| 送信(5 分) | 変更があるときだけ | 同じ |
| 手動 | 同期ボタン | 同じ |

- 既読は `readFlush` の呼び出し(タブの切り替え・閉じる)でも周を起こす
- 値は定数(`packages/sync/src/config.ts`・`SyncConfig.kt`・`sync-config.json`)で揃え、共通テストに入れる

| 定数 | 値 |
| --- | --- |
| `HEAD_INTERVAL_MS` | 1 分(確認の基本の間隔) |
| `HEAD_BACKOFF_MAX_MS` | 5 分(伸ばした確認の間隔の上限) |
| `PUSH_INTERVAL_MS` | 5 分(変更があるときだけ) |
| `PULL_MIN_GAP_MS` | 10 秒 |
| `IDLE_STOP_MS` | 10 分 |
| `NET_SETTLE_MS` | 5 秒 |
| `NET_MIN_GAP_MS` | 30 秒 |
- pull の間隔の 10 秒はエンジンが守る。手動だけ例外

値は Cloudflare Workers の無料枠(Workers・Durable Objects とも 100,000 要求/日、SQLite の書き込み 100,000 行/日。`/records` は N 件で 2N + 2 行)に利用者 100 人(1 人 PC + スマホ)を収めるために決めた(設計書の「費用」)。要求を減らす仕掛けは 4 つ。

**確認の間隔を伸ばす(`SyncScheduler`)。** `/head` が「変化なし」(304。通信の失敗も同じ扱い)を返すたびに次の確認までの間隔を 2 倍にし、`HEAD_BACKOFF_MAX_MS` で止める(1 → 2 → 4 → 5 分)。基本の間隔に戻すのは、前面に戻った(`foreground`)、利用者の操作(`activity`。放置で止めない端末でも戻すだけは行う)、確認が変化を返した、周を回した(`run`)の 4 つ。操作のときに確認が遅れていればすぐ確認する。サーバーの `pace` はこれまでどおり下限で、指示が上限より長ければ指示のまま。送信の時計は確認とは別に `PUSH_INTERVAL_MS` ごとに起きて、送るものの有無を見る(確認を遠ざけている間も送信は 5 分で出る)。裏に回る瞬間の送信と前面に戻ったときの pull は、この間隔に関係なくすぐ行う。

**確認の ETag は覚えない(エンジン)。** `If-None-Match` は手元の `sync_state` の `epoch` と `since` から `"<epoch>:<since>"` を作って付ける。サーバーの応答を覚えておく形だと、変化を見た直後の周が通信の失敗で終わったときに次の確認が 304 になって取り残しが長引くので、手元が実際に読んだ所だけを根拠にする。

**自分の送ったものを読み戻さない(エンジン `settlePush`)。** `/records` の応答が全部 200 で、返った `version` が「手元の `since` + 1 から連番で隙間なし」なら、増えたのは自分の送ったものだけなので `since` をその最大に進める。次の `/head` は 304 になり、`/changes` で自分のレコードを読み戻さない。隙間がある(間に別の端末が書いた)・409 がある・応答の数が送った数と違うときは何もしない(次の確認が変化を見て読む)。

**自動の周で pull を省く(エンジン `step`)。** 確認の時計と裏に回る瞬間の周(`runCycle` の `quick`)では、直前の確認が「変化なし」で、それから確認の間隔(`pace` があればその値)+ `PULL_MIN_GAP_MS` 未満しか経っていなければ `pull(false)` を飛ばす(確認の時計は前の確認が終わってから数えるので、次の周は間隔よりわずかに遅れて来る。その分の余裕)。省いた間に別の端末が同じレコードを書いていれば `/records` の 409 で分かり、今の流れでマージして読み直す。手動・前面復帰・ネットワークの復帰・合流・作り直し・リベースの流れは変えない。確認が変化を見たあとの周は省かない。

### 同時実行の防止

| 範囲 | 方法 |
| --- | --- |
| 1 つの画面の中 | 周の Promise・`Mutex`。走っている間のきっかけは「もう 1 周」の印にする |
| PC の複数の窓 | エンジンは main だけが動かす |
| PC の 2 つの起動 | `engine_lease`。`UPDATE sync_state … WHERE 期限切れ or 自分` が 1 行なら持ち主。30 秒ごとに延ばす。取れなければ動かない |
| スマホの画面 | `AppViewModel` が持つ `Mutex`。`LogDb` と `Prefs` は画面と同じもの |
| エンジンと利用者の操作 | `sync_ops` を挟むので触れ合わない。後の操作が後の HLC で勝つ |

### 前面の間だけ動く

バックグラウンドの処理を持たない。スマホの WorkManager を使わない。「前面」はスマホは `onStart`〜`onStop`、PC は窓が見えている間(`visibilityState === 'visible'`)。

| 場面 | PC | スマホ |
| --- | --- | --- |
| 裏に回る瞬間 | `visibilitychange` か `blur` で、送信待ちがあれば 1 回だけ周を回す | `onStop` で 1 回だけ周を回す(`viewModelScope`)。止められてもよい |
| 窓を閉じる | **`CloseRequested` の処理は今ない。** `on_window_event` を足し、main を閉じるとき `sync-flush` を送って 1 回だけ試す。待つのは最大 3 秒 | なし(`onStop` と同じ) |
| 送れなかった | 送信待ちが DB に残り、次の前面復帰で送る | 同じ |
| 裏にいる間 | 周を始めない。時計を止める | 同じ |

- 周の途中で止められても壊れない。`sync_ops`・`pending`・`needs_apply`・`push_inflight` が DB にあるので、次の前面で続きから動く
- 限界: スマホで読んですぐ閉じ、送れなかった分は、次にスマホを開くまで他の端末に届かない。9 章の説明に書く

### leave と周回の排他

`leave`・`pair`・サーバーの URL の変更は、先に `halt` で走っている周を止める。周は次の区切り(通信の応答の後・ページ・送信の回)で止まり、古い領域の受信を書かない。表を消すのはその後。

### 再送

設計書の「エラー」のとおり。端末の中の決まりは次を足す。

| 場面 | 決まり |
| --- | --- |
| `request_id` | `push_inflight` に `request_id` と `record_id`・`hlc` の一覧を保存してから送る。応答が来ないまま落ちたら、同じ ID で送り直す。暗号文は保存せず封をし直す(1 回 1MB を毎回書かないため)。その間に変わったレコードは今の値を送り、`hlc` が一覧と違うので `pending` が残って次でまた送る。pull で片づいたものは送らず、全部片づけば一覧を消す |
| 応答の成功 | `UPDATE … SET version = ?, pending = 0 WHERE record_id = ? AND hlc = ?`。送信中に変わったレコードは `version` だけ進め、`pending` を残す |
| 409 | 応答のレコードを `mergePayloads` して、新しい `version` を `base_version` に再送。応答の `record_id` が送ったものと違えば混ぜず、`bad_counts.swapped` に数える(別のレコードの暗号文のすり替え) |
| 待ち時間 | `backoffDelayMs(回数, jitter)`。1 秒から最大 60 秒を倍々にし、半分をジッターにする。表は `sync-config.json` |
| 1 周の送信 | 100 件・1MB ずつ、最大 20 回。残りは次の周 |
| 413 | 上の「容量を超えるとき」のとおり外して送り直す。外せるものがなければ `last_error` に書いて `pending` を残す |
| 読み取りの上限 | 1 応答 2MB。超えたら捨てて `backoff` |
| version が進まない | ページングを止める |
| リダイレクト | 3xx は失敗。たどらない |

### サーバーとの形

全部の形は `packages/conformance/sync-server-rules.json` に例がある。

| 要求 | 応答 |
| --- | --- |
| `POST /tickets` 本文 `{ turnstile, space_id }`。トークンなし | 200 と `{ ticket, exp }`。`403 turnstile_invalid`・`503 turnstile_unavailable`・`503 unavailable`。端末は呼ばず、同期を始めるページが呼ぶ |
| `POST /spaces` 本文 `{ ticket }` | 作成は 201、あれば 200。`{ epoch, created }`。断るときは 403 と `{ error }`(`ticket_required`・`ticket_invalid`・`ticket_expired`・`pow_required`・`pow_invalid`・`capacity_full`・`creation_closed`) |
| `GET /changes?since=N` | `{ records, head, more, epoch, gc_floor }`。最後のページの後は `since = head` |
| `POST /records` 本文 `{ request_id, records }` | 200 と `{ results, epoch, gc_floor }`。`results` は `{ record_id, status: 200, version }` か `{ record_id, status: 409, record }` |
| `GET /head` | `{ version, epoch, gc_floor }`。ETag は `"<epoch>:<version>"`。同じなら 304 |
| `GET /space` | `{ used_bytes, record_count, quota_bytes, quota_records, epoch, gc_floor }` |
| `DELETE /space` | `{ deleted: true }` |

- 作成の問題: サーバーが `POW_BITS` を 1 以上にしていると、許可証の通った `POST /spaces` は 403 と `{ error: "pow_required", pow: { challenge, bits } }` を返す。端末は `SHA-256("<challenge>:<nonce>")` の先頭 `bits` ビットが 0 になる `nonce`(`[A-Za-z0-9_-]` の 64 文字まで)を探し、本文 `{ ticket, pow: { challenge, nonce } }` で 1 回だけ送り直す。問題は 5 分有効で、その領域にしか使えない。`bits` が 28 を超える問題は解かない。例は `packages/conformance/sync-pow.json`。PC は `packages/sync/src/engine/pow.ts`、スマホは `obb/sync/engine/SyncPow.kt`
- 許可証の決まりは `packages/conformance/sync-ticket.json`。端末は形と `space_id` だけを確かめ(`ticketSpaceId`)、合わなければ `bad_ticket` で受け取らない
- `ticket_*` は待っても直らないので、作り直しのときでも `recreate_waiting` にせず `blocked` にする。`setTicket` で置き直し、手動の同期で続く
- 作成元の制限と締め出しは、全体の停止と同じ `creation_closed`
- 1 回の 409 に入るレコードは合計 1.5MB まで(読み取りの上限 2MB に収めるため)。入らない分は `results` に出ないので、送信待ちのまま次の回で送り直す
- `POST` は `Content-Length` と `Content-Type: application/json` が要る。ないと 413・415。圧縮した本文は 415
- `request_id` は領域ごとに新しい 64 件だけ覚える。忘れられた後の再送は 409 で自分の値が返り、マージしても変わらない
- `request_id` は `[A-Za-z0-9_-]` の 22 文字(16 バイト)。`epoch` は 128 文字までの文字列で、端末は中身を解釈しない
- 失敗は `{ error }`。端末は 4xx の `error` を `last_error` に写す
- `since=0` の回数は、中身のある領域だけ数える。空の領域を数えると、まだ何も送っていない端末が止まる
- 全件の中の開けないレコードも `version` は数える。開けないものでページングが止まらないように

### リベース

| 条件 | |
| --- | --- |
| `since < gc_floor`(`epoch` は同じ) | `rebasing`。消えたものを手元から消す |
| `epoch` が変わった | 下の「領域が消えたとき」。何も消さない |

1. 全件を読む(`since=0` は 1 時間に 3 回まで。超えたら `backoff`)
2. `planRebase` を呼ぶ。最後のページまで読めなかったときは `complete: false` で渡す。届いていないものは消さず、未送信も捨てず、計画に残す。読めた分のマージだけを行い、`since` は進めない。消えたものを決めるには全部の ID が要るので、次の周はもう一度最初から読む
3. `needs_confirmation` なら、計画を `pending_confirm` に保存して `confirm` へ
4. 消す前に、消える項目の一覧を `sync_state` の `rebase_backup` に保存する
5. `records`・`pending`・`removed` を 200 件ずつ書く
6. 終わったら `since = max(head, gc_floor)`。一番新しい version が片づいた tombstone だと、最後のレコードの version では `gc_floor` に届かず、毎周リベースになるため

確認の答えは `accept_removal`(消す)か `keep_local`(消さない。領域が消えたときと同じく `planRecreate` で全部を合わせ直して送る)。`since = 0` の端末は全件を読むのでリベースにしない。

- `removed` のうち、手元のペイロードがすでに tombstone のものは今のデータに触らない。行を消すだけ
- tombstone の片づけは大量削除の確認に数えない(分子にも、同期済みの分母にも)
- 連続のリベースは 1 日 3 回まで。超えたら `blocked`(`too_many_rebases`)にして知らせる。`epoch` の変更と 404 の作り直しも同じ回数に数える(どれもサーバーの応答で起きるので)

### 領域が消えたとき

押し出し、管理者の削除、放置削除、サーバーの事故のどれでも同じ流れにする。手元のデータと同期の表が残っているので、端末から作り直せる。

サーバーは保管庫ではない。押し出し・放置削除・管理者の削除で領域が消えるのは普通のことなので、確認を出さない。

| 順 | 最初に気づいた端末 | 他の端末 |
| --- | --- | --- |
| 1 | 404 を受ける。確認なしで次へ進む | 作り直しの前なら同じ。後なら `epoch` の変更で気づく |
| 2 | `POST /spaces`(同じ `K`・同じ `space_id`・保管している許可証)。人の操作は要らない。すでにあれば 200 で中身は変わらない | 同じ |
| 3 | `since = 0` にして新しい `epoch` を保存。全件を受け取る | 同じ |
| 4 | `planRecreate` で手元と合わせる | 同じ |
| 5 | `pending` を全部送る。tombstone を先に(`priority = 0`) | 同じ |

`planRecreate({ local, full, nowMs })` の決まり。戻り値は `records`・`pending`・`expired`(同期の表から消すもの)。`planRebase` はこの場面に使えない(途中までしか届いていない全件を正として手元を消し、90 日より古い種まきの値を未送信として捨てるため)。

| 手元 | サーバー | 結果 |
| --- | --- | --- |
| あり | あり | `mergePayloads`。サーバーの値と違えば `pending` |
| あり | なし | `version = 0`・`pending = 1` |
| なし | あり | 受け取る |
| tombstone で `tomb_at` が 90 日より古い | なし | 同期の表から消す。送らない |

- **手元を消さない。** 計画に `removed` がないので確認が要らない。リベースの大量削除の確認は別で残す
- 作り直しの途中で裏に回ったら止める。次の前面で続きから動く
- 満員なら `recreate_waiting` にして、前面に来るたび(最短 1 時間あけて)また試す。押し出せる領域ができれば通る
- 全端末がマージ関数(可換・結合的・冪等)で全件を合わせるので、届く順によらず収束する。先に送った端末と同じレコードは 409 になり、マージして同じ値なら送らない
- `epoch` の変更は、サーバーの事故でも悪意のあるサーバーでも同じ流れ。手元の削除につながらない。起きても暗号文を送り直すだけ

### tombstone の保持

| 決まり | 理由 |
| --- | --- |
| 同期の表の tombstone は、この端末で tombstone になってから 90 日残す(`tomb_at`)。サーバーの領域が消えても残す | 作り直しのとき、削除済みが他の端末の古い値から復活しないため |
| 90 日を過ぎたら 1 日 1 回の片づけで消す | 増え続けないため |
| 普通のリベースの `removed` でも、期限の前の tombstone は消さない。`version = 0` で残し、送らない | 同じ |
| `tomb_at` は最初に tombstone になった時刻のまま。新しい tombstone で延ばさない。マージの後は `settleRecord` で決める | 期限を保つ |
| 期限の判定は `isTombExpired`。ちょうど 90 日はまだ残す | 端末で揃える |

### 鍵

実装の口は共通にする。

```ts
interface SyncKeyStore {
  load(): Promise<{ k: Uint8Array; deviceId: string; ticket: string | null } | null>
  save(v: { k: Uint8Array; deviceId: string; ticket: string | null }): Promise<void>
  clear(): Promise<void>
}
```

| 端末 | 置き場 | 注意 |
| --- | --- | --- |
| Windows | 資格情報マネージャー(`keyring-core` と `windows-native-keyring-store`。`src-tauri/src/sync_key.rs`) | Rust の命令。呼べるのは `main` の窓だけ(`window.label()` を確かめる。権限は全窓で共通なので)。設定の窓は `callMain` で頼む |
| Linux | Secret Service(`zbus-secret-service-keyring-store`。libdbus が要らない) | 使えなければ同期を始めず、理由を出す |
| スマホ | Android Keystore の AES-GCM の鍵で包み、**専用の Prefs `sync_key`** に置く(`data/SyncKeyVault.kt`) | `settings` の Prefs に置かない。`allowBackup=false` に加えて `data_extraction_rules.xml` で端末の移行からも外す。包む鍵がなくて開けない値は鍵なしと同じ |

- 許可証は鍵ではないが、`K` と一緒に動くので同じ所に置く。DB の入れ替えで消えない
- PC の鍵は TypeScript の核で使うため、`main` の WebView のメモリに入る。`innerHTML` を使わない決まりが守りの前提
- 許可リスト: `Prefs.export`(除く方式)・`settingsFile`(除く方式)に同期の項目が入らないことをテストで確かめる。URL の上書きも除く

### DB の入れ替え(PC)

`schedule_db_restore` は DB を丸ごと戻す。`VACUUM INTO` のファイルは `sync_*` も含む。放っておくと次の問題が起きる。

- HLC と `since` が過去へ戻る
- 別の PC に入れると `device_id` が 2 台で同じになり、`read_dev` がぶつかる

対策は次のとおり。

- 鍵保管に `deviceId` も置く(`SyncKeyStore`)
- `sync_state.enabled` も鍵の控え(PC は `localStorage`、スマホは Prefs の値の有無)もなければ、鍵保管を開かない。使っていない人は Secret Service の解錠を求められない
- 起動時に `checkDeviceId(鍵保管の deviceId, sync_state.device_id)` で比べる

| 結果 | 場面 | 動き |
| --- | --- | --- |
| `none` | どちらもない | 同期を使っていない |
| `ok` | 同じ | そのまま |
| `clear` | 鍵保管が空で DB にある | `sync_*` を消して `off` に戻す。領域の再参加はペアリングから |
| `rejoin` | 違う。または DB にない | `sync_records`・`sync_ops` を空にし、`since`・`clock`・`epoch`・`phase`・`push_inflight` も消す。`generateDeviceId` の新しい値を鍵保管と DB に書き、`joining` から。許可証は残す |

- `device_id` が変わると古い `read_dev` は領域に残るので、既読位置は下がらない
- 同じ端末の古い DB に戻したときは `ok` になる。`device_id` は重複しない。`since` と `clock` が戻るだけで、次の pull で全部をマージし直して追いつく
- スマホのバックアップは JSON で、`importBackup` は操作として積む。`allowBackup` は false

### 同期領域の削除と端末の離脱

| 操作 | サーバー | 手元のデータ | 同期の表 | 鍵 | サーバーの URL |
| --- | --- | --- | --- | --- | --- |
| この端末で同期をやめる | 触らない | 消さない | 消す | 消す | 既定へ戻す |
| 領域を削除する(全端末) | `DELETE /space` | 消さない | 消す | 消す | 既定へ戻す |
| 他の端末 | 次の 404 で作り直す。領域を使い続けたくないなら各端末で「同期をやめる」 | 消さない | 触らない | 触らない | 触らない |

- `read_dev` の自分のレコードは離脱で残る。消すと既読位置が下がる
- 離脱した端末の `read_dev` は 90 日で片づける案もあるが、スレごとの値が合わなくなるので、まず残す(U9)

### サーバーの URL

| 項目 | 決まり |
| --- | --- |
| 既定値 | `packages/sync/server-url.json` の 1 か所。PC は `VITE_OBB_SYNC_SERVER_URL`、スマホは `OBB_SYNC_SERVER_URL` でビルドのときに差し替えられる |
| 設定 | 上書きの欄だけを保存する。空なら既定値。**上書きしていない人は、アプリの更新で既定値が変われば新しい先へ行く** |
| 保存先 | `sync_state.server_url`。`settings` に入れない。離脱すると既定値に戻る(参加のコードで入った先に、やめたあとも向いたままにしない)。DB を入れ替えると既定値に戻る |
| 参加のコード | コードの URL は pair が通ってから書く(失敗した参加の先を残さない)。既定と違う URL なら、書く前に確認を出す(「ペアリング」) |
| 検査 | `https:` だけ。利用者名・パスワード・クエリ・フラグメントを拒否。開発の版だけ `http://localhost` を許す |
| リダイレクト | PC は Rust の命令 `sync_http`(`src-tauri/src/sync_http.rs`)。`plugin-http` は掲示板の Cookie の置き場を共有し、全体の打ち切りと読み取りの上限を持たず、通信先も権限の表(http を含む)任せになるので使わない。WebView の `fetch` はサーバーが CORS を出さないので使えない。スマホは同期専用の `OkHttpClient`(`followRedirects(false)`・`followSslRedirects(false)`・Cookie なし・`HttpsFirst` なし。`Http.client` を使わない) |
| 変更 | 確認を出す(新しい先に `auth_token` が渡る)。使っている間に変えたら、`since = 0`・`recreate_pending` で全件を合わせ直す。新しい先に領域がなければ作り、手元を全部送る |
| 開発の版 | `http://localhost` を許すのは PC の開発の版とスマホの debug だけ。スマホの release は `-PobbSyncAllowLocalhost` を付けたときだけ(R8 を通した版で試すため) |
| 別の領域 | サーバーを変えても `space_id` は同じ。新しい先に領域がなければ作成の流れへ |

試験の間は `workers.dev` の検証用の URL が既定値になる。本番のドメインを決めたら定数を変えて更新する。古い版のために、古い入口はしばらく残す。

## 9. 画面

PC とスマホで同じ言葉にする。`bbs-suite/docs/parity.md` の表に足す。

### 設定の項目

設定の大分類「同期(実験的)」。PC は settings の分類(`SyncTab.tsx`)、スマホは大分類からの小画面(`SyncPage.kt`)。設定の検索に入れる。

| 項目 | 内容 |
| --- | --- |
| 同期を使う | スイッチ。既定はオフ。上に実験的であることとサーバーは保管庫でないことの説明 |
| 状態 | スイッチがオンのときだけ。状態・領域・送信待ち・最後の受信と送信・最後のエラー |
| 同期を始める・コードで参加(スマホは端末を追加の QR) | スイッチがオンで、まだ領域に入っていないとき |
| 今すぐ同期・端末を追加・この端末で同期をやめる | 領域に入っているとき。やめるときは確認あり |
| 同期するもの | 閲覧履歴と既読・お気に入り(スレ・板)・サイト・書き込み履歴・上げた画像の履歴・NG・設定・画像の削除キー・管理トークン。各スイッチ。始める前に選べる |
| 画像の削除キー・管理トークン | 既定はオフ。オンにするときだけ危険を説明して確認する |
| 同期の要約 | 領域に入っているとき。不一致の検査 |
| サーバーの URL | 詳しい設定。確認あり |

未実装: この種類をサーバーから外す、同期のデータをすべて消す。

### 最初の説明(試験の間)

| 項目 | 文 |
| --- | --- |
| 題 | 同期(試験機能) |
| 本文 | 履歴やお気に入りを、暗号化して別の端末と同期します。 |
| 注意 | サーバーは保管庫ではなく、端末の間の中継の置き場です。しばらく使わないと、サーバーのデータは消えます。この端末のデータは消えません。 |
| 注意 | サーバーのデータが消えても、自動で作り直します。もう片方の端末を開くと揃います。 |
| 注意 | 同期はアプリを開いている間だけ動きます。スマホで読んですぐ閉じ、送れなかった分は、次にスマホを開くまで他の端末に届きません。 |
| 注意 | 端末を全部なくすと、データは戻せません。 |
| 注意 | 同期を切っても、この端末のデータは消えません。 |
| 注意 | Cookie は同期しません。端末ごとに書き込みの ID が変わります。 |
| ボタン | 試験に参加する / やめておく |

既定はオフ。自分で押した人だけが使う。

### 同期を始める(1 台目)

1. 「同期を使う」→「同期を始める」。`K` を作り、窓で `/start?space_id=…&return=app` を開く
2. 窓の中で Turnstile を通す
3. 移動を止めて許可証を受け取り、窓を閉じる。`K` と許可証を鍵保管に置く
4. 全件を受け取る・種まき

取り消して窓を閉じたら、`K` を捨てて使っていない状態へ戻す。形とその理由は `docs/sync-design.md` の「許可証の受け渡し」。

| 窓の作り | PC | スマホ |
| --- | --- | --- |
| 開き方 | `WebviewWindowBuilder` の別窓。`capabilities` の対象に入れない | 専用の `WebView`。`addJavascriptInterface` を使わない |
| 受け取り | `on_navigation` で `https://obb-sync.invalid/ticket` を止めて `query_pairs` で読み、`main` へだけ渡す | `shouldOverrideUrlLoading` で `isForMainFrame` の同じ URL を止めて読む |
| 許す先 | 同期サーバーの origin、`challenges.cloudflare.com`、`about:blank`、`about:srcdoc`。ほかは止める | 同じ |
| Turnstile の要件 | User-Agent を途中で変えない | JavaScript と DOM storage を有効にし、第三者の Cookie を許す。User-Agent を途中で変えない |
| 片づけ | 窓を閉じる | `clearHistory`・`clearCache`、`destroy` |

### ペアリング

| 手順 | 既存の端末 | 新しい端末 |
| --- | --- | --- |
| 1 | 「端末を追加」 | 「同期を使う」→「ほかの端末につなぐ」 |
| 2 | `K` と許可証の QR とコードを 60 秒。残り時間と「他の人に見せないでください」 | スマホは QR、PC はコードを貼る。Turnstile は通さない |
| 3 | 閉じる | 手元に送るものがあるか、コードのサーバーが既定と違えば、参加の確認(下) |
| 4 | | 全件を受け取る(進み具合) |
| 5 | | 確認があれば出す |
| 6 | | 「同期を始めました」 |

スマホの表示中は `FLAG_SECURE`。

**参加の確認(`join_data`)。** 参加は手元の全部を相手の鍵で読める形にして相手のサーバーへ送るので、他人の QR・コードを読んだときの歯止めとして `SyncController.join` が pair の前に止まる(状態は `confirm`。`status().confirm` と `join` の戻りに `{ type: 'join_data', lost: 0, host }`)。答えが出るまで鍵も URL も書かず、通信もしない。

| 条件 | 文 |
| --- | --- |
| 手元に同期の対象のデータがある(閲覧履歴・お気に入りのスレ・板・書き込み履歴・サイト・NG のどれかが 1 件以上。最初から入っている掲示板・板は数えない。`hasLocalData`) | 「この端末の閲覧履歴・お気に入り・書き込み履歴・設定が、この同期へ送られます。相手の鍵で読めるので、自分の端末の QR 以外は読まないでください。」 |
| コードのサーバーが既定(`server-url.json` / `BuildConfig.SYNC_SERVER_URL`)と違う | 上の文に 1 行足す。「同期サーバー: <ホスト名>(ふだんと違います)」 |
| どちらも当たらない(まっさらな端末で既定のサーバー) | 確認なしで参加する |

選択肢は「参加する」(`accept_removal`。pair → URL を書く → 全件を受け取る)と「やめる」(`keep_local`。何も書かず、使っていない状態のまま)。言葉は `sync-ui.json` の `join_ask`・`join_ask_server`・`join_ok`・`join_cancel`。

### 状態の表示

設定とサイドバー(スマホは左のメニュー)の下に小さく出す。

| 状態 | 文 |
| --- | --- |
| 動いている | 同期中 |
| 終わった | 同期済み(3 分前) |
| 溜まっている | 送信待ち N 件 |
| 通信できない | オフライン |
| 初回 | 準備中 N / M |
| 作り直している | サーバーのデータを作り直しています。もう片方の端末を開くと揃います |
| 開けないレコード | N 件を読めませんでした |

### エラー

| コード・場面 | 文 | 動き |
| --- | --- | --- |
| 401 | この端末の鍵が使えなくなりました。もう一度つないでください。 | `blocked` |
| 404 | 画面に出さない。状態の表示だけ「作り直しています」 | 確認なしで作り直す |
| 404 の後に `capacity_full` | サーバーのデータが消えましたが、いまは満員で作り直せません。この端末のデータはそのまま使えます。空いたら自動で揃います。 | `recreate_waiting`。手元の記録は残す |
| `capacity_full`(新規) | 同期は満員です。枠が空くまで作れません。この端末のデータはそのまま使えます。 | `blocked`。自動で再試行しない。次に開いたとき再度押せる |
| `creation_closed` | 同期の新規作成を止めています。この端末のデータはそのまま使えます。 | 同じ。サーバーの全体の停止と作成元の締め出しを同じコードにする |
| `ticket_required`・`ticket_expired`・`ticket_invalid` | 同期を続けるには、もう一度確認が必要です。この端末のデータはそのまま使えます。 | `blocked`。「同期を始める」を出す。通すと `setTicket` して手動の同期 |
| ページの `turnstile_unavailable` | 確認の仕組みが止まっています。少し待ってからお試しください。 | 窓の中で出す。既存の同期は続く |
| 413 | 同期の容量がいっぱいです。古い閲覧履歴を外しました。 | 知らせだけ |
| 429 | 少し待ってから同期します。 | `backoff` |
| Secret Service なし | この環境では鍵を安全に保存できないため、同期を使えません。 | `off` |

満員は、14 日使われていない領域ができると押し出して空く。枠は運営が環境変数で増やすこともある。空き待ちの通知は作らない。

領域が消えた理由(管理者か放置か事故か)は端末から分からないので、言い分けない。

### 確認の場面

| 場面 | 文 | 既定 |
| --- | --- | --- |
| リベースで大量に消える | サーバーと比べると、この端末の N 件が消えます。一覧を確かめてください。 | 消さない |
| 全件が空に見える | サーバーのデータが空になっています。この端末のデータを送り直しますか? | 送り直さない |
| 合流で消える | 同期のデータで削除された N 件が、この端末からも消えます。 | 進まない |
| 合流の設定 | 設定は同期のデータに合わせます / この端末の設定を使う | 合わせる |
| サーバーの URL の変更 | 新しいサーバーに認証の情報を送ります。 | 変えない |
| 参加で手元を送る | この端末の閲覧履歴・お気に入り・書き込み履歴・設定が、この同期へ送られます。相手の鍵で読めるので、自分の端末の QR 以外は読まないでください。(URL が違えば「同期サーバー: <ホスト名>(ふだんと違います)」) | やめる |
| 種類を外す | サーバーから外します。ほかの端末の手元のデータは消えません。 | しない |
| すべて消す | サーバーの同期のデータを消します。ほかの端末は同期できなくなります。各端末のデータは残ります。 | しない |

## 10. 共通のテスト

### 形

`packages/conformance/sync-client.json` を PC とスマホの単体テストで読む。既存の `sync-*.json` と同じ置き場で、`build.gradle.kts` の `sourceSets["test"].resources.srcDir` で届く。

- `steps` の `op` は実行部(`packages/sync/test/scenarioRunner.ts`・`SyncScenarioTest.kt`)の一覧のとおり。途中の確かめは `{ "op": "expect", "expect": { 端末: { … } } }`
- シナリオの後に、今のデータと同期の表の全列を並べた SHA-256 を比べる。値は `sync-client-digests.json` に置き、PC で `SYNC_UPDATE_DIGESTS=1` を付けて回すと書き直す。スマホは読んで比べるだけなので、同じ行ができたことまで確かめられる
- `sync-config.json` は定数・待ち時間・サーバーの URL の検査の表

```json
{
  "name": "2 台の並べ替えは同じ結果",
  "devices": ["pc", "phone"],
  "seed": { "pc": { "favorite_boards": ["a", "b", "c"] } },
  "steps": [
    { "device": "pc", "op": "pair_first" },
    { "device": "phone", "op": "pair_join", "from": "pc" },
    { "device": "pc", "op": "favorite_board_order", "args": ["c", "a", "b"] },
    { "device": "pc", "op": "sync" },
    { "device": "phone", "op": "sync" }
  ],
  "expected": {
    "phone": { "favorite_boards": ["c", "a", "b"], "pending": 0, "ops": 0 }
  }
}
```

| 部品 | PC | スマホ |
| --- | --- | --- |
| 時計 | `steps` の `advance_ms`。テストの固定値 | 同じ |
| 偽の DB | sql.js に実際の移行 SQL を流す | `sqlite-jdbc`(別の担当が `testImplementation` に足した)に同じ SQL を流す。`android.database` は単体テストで動かないので、`LogDb` の SQL を口の裏に分ける(`UploadsSqlTest` と同じ考え) |
| 偽のサーバー | 同じ規則のメモリの実装(version・409・gc・`epoch`) | 同じ |
| 故障の差し込み | `{ "op": "server_fail", "status": 500, "times": 1 }` | 同じ |

- 偽のサーバーの決まりは `packages/conformance/sync-server-rules.json` で、後で実物のサーバーでも流す
- 比べるのは今のデータと `sync_records` の `payload`。リセットの `id` と `device_id` はテストの固定値を差し込む。ノンスの乱数はペイロードに出ないので比較に影響しない

### 件数

`sync-client.json` は 171 件(後半の 25 件はスイッチの組み合わせ。名前が `スイッチ:` で始まる)。`sync-client-random.json` は順序・重複・中断を乱数で作った 20 件で、生成した手順を PC とスマホと Miniflare で流して digest を比べる。生成は `packages/sync/test/randomScenario.ts`。ほかに PC で 300 シードずつ回す。枠 2 のシミュレーターは `packages/sync/test/slotScenarios.ts`(偽サーバーと Miniflare)。比較に失敗すると、どのレコードのどの値が違うかを 1 行ずつ出す(`diffSnapshots`)。検証用の Worker へは `OBB_SYNC_VERIFY` に URL を入れて `packages/sync/test/verifyServer.test.ts` を回す。

### 一覧

| 番号 | シナリオ | 確かめること |
| --- | --- | --- |
| 1 | お気に入りのスレを足し、もう 1 台で同期 | 足された |
| 2 | 足した直後に外す | tombstone が伝わる |
| 3 | 2 台で同時に足すと外す | HLC の新しい方 |
| 4 | プリセットの追加 | 送らない |
| 5 | ログの削除 / `pruneLogs` | 削除は全端末のログと履歴の行を消す(消した後に読んだ端末は残る)。`pruneLogs` は何も送らない。どちらもお気に入りと書き込み履歴を消さない |
| 6 | 履歴から外す | 別の端末の `read_at` が NULL、ログは残る |
| 7 | 既読のシナリオ表の全部 | `threads.read_no` が表の値 |
| 8 | ログのないスレの `last_view` | 空の行。`read_no` が入る |
| 9 | 保持日数より古い `last_view` | 行を作らない |
| 10 | ログを消して開き直す / 自動整理のあとに開き直す | 未読から始まる / 既読が戻る |
| 11 | 読んでいる最中に上がる・下がる | タブの `unreadFrom`・位置が動かない。DB は変わる |
| 12 | スクロールで 100 回 `markRead` | `sync_ops` 1 行、`steps` 1 件 |
| 13 | 適用した変更 | `sync_ops` が増えない。送り返さない |
| 14 | 並べ替えの同時実行 | 収束する。`sort` が全端末で同じ |
| 15 | キーが 256 桁を超える | 振り直しても順が同じ |
| 16 | NG の追加・編集・削除 | 1 要素ずつ伝わる |
| 17 | 期限切れの自動の片づけ | tombstone なし |
| 18 | 読めない正規表現 | 適用しない。止まらない。保持する |
| 19 | 許可リストの外の設定 | 送らない。受けても書かない |
| 20 | 秘密の設定 | 送らない |
| 21 | 書き込み履歴の種まきを 2 回 | 重複しない |
| 22 | 1 台目の種まき | 古いデータが新しい tombstone に負ける |
| 23 | 2 台目の合流 | 和集合。領域の並びが崩れない |
| 24 | 合流で 10 件以上消える | `confirm` で止まる |
| 25 | 知らない種類・知らないフィールド | 保持して再送 |
| 26 | スマホにないふたばのレコード | 手元に入れない。再送で消えない |
| 27 | 同じ板の `http`・`5ch.net` | 同じレコード。手元の行を二重に作らない |
| 28 | 種類をオフにして戻す(種類ごと) | 送らない。受け取っても写さない。戻すと両方の変更が揃う |
| 29 | `trim` の tombstone | 他の端末の手元は消えない |
| 30 | 413 | 優先の低いものから外して再送 |
| 31 | 409 | マージして再送 |
| 32 | 送信中に同じレコードを更新 | `pending` が残る |
| 33 | 応答が来ないまま落ちる | 同じ `request_id` で再送 |
| 34 | 適用の途中で失敗 | 巻き戻り、次の周で続く |
| 35 | `gc_floor` の変更 | リベース。削除が復活しない |
| 36 | サーバーが空を返す | `confirm`。手元を消さない |
| 37 | version が進まない応答 | 止まる |
| 38 | 別のドメインへのリダイレクト | トークンを渡さない |
| 39 | `capacity_full`・`creation_closed` | `blocked`。手元が残る。自動で再試行しない |
| 40 | 離脱 | 手元が残る。同期の表と鍵が消える |
| 41 | DB の入れ替え(PC) | `device_id` が変わる |
| 42 | 同じ HLC・同じ端末 | キーを並べた JSON の順で決まる |
| 43 | 領域の削除 → 確認なしの作り直し → 2 台の合流 | 全端末が一致する。削除が復活しない。手元が消えない |
| 44 | 作り直しの途中(全件の半分だけ届いた所)で他の端末が合流 | 手元を消さない。両方が送り切って一致する |
| 45 | 2 台が同時に作り直す | 領域は 1 つ。409 のマージで一致する |
| 46 | `epoch` の変更だけを返すサーバー | 手元を消さない |
| 47 | tombstone の 90 日の片づけ | 期限の前は残り、後に消える |
| 48 | 404 の後に満員 | 手元と同期の表が残り、空いたら自動で作り直す |
| 49 | 押し出された端末の送信待ち | 未送信が失われず、作り直しで届く |
| 50 | 裏に回る瞬間の送信が途中で切れる | 送信待ちが残り、次の前面復帰で同じ `request_id` で届く |
| 51 | ネットワークの復帰(偽の時計) | 5 秒待つ。前回から 30 秒未満なら同期しない。30 秒以上なら同期する |
| 52 | 裏にいる間 | 周が始まらず、通信しない |
| 53 | 変更がない間の `HEAD_INTERVAL_MS` | 送らない |
| 54 | 許可証がない | 作成を送らず `blocked`。手元が残る。通すと続く |
| 55 | 領域が消える | 同じ許可証で作り直す。ページを通した回数が増えない |
| 56 | 2 台目 | 許可証を受け取り、Turnstile を通さず作り直せる |
| 57 | 許可証の期限切れ | `blocked`。自動で再試行しない。通し直すと作り直す |
| 58 | サーバーが許可証を断る | `recreate_waiting` にせず `blocked` |
| 59 | 計算の問題 | 許可証と答えを送り直して作る |
| 60 | 参加: 手元にデータがある | 確認が出る(`pair_join` の `asks`)。やめると鍵も書かず何も送らない。参加すると和集合 |
| 61 | 参加: まっさらな端末(最初から入っている掲示板・板だけ) | 確認なしで参加する |
| 62 | 読んでいる最中に他の端末の削除が届く | 開いていても行が消える(画面が閉じる)。開き直して読み進めると上がる |
| 63 | 自分のレスの印: 手で付ける・外す | 別の端末に届く。外すと tombstone で消える。スレの行がなくても入る |
| 64 | 自分のレスの印: 書き込みで付く | `post_add` と一緒に届く。外しても書き込み履歴は残る |
| 65 | 自分のレスの印の種まき | 手元の全行が送られ、合流は和集合 |
| 66 | 種類を足す前に合流した端末の設定と NG | `fill` で送られる(起動の照合を待たない) |

端末ごとのテスト(共通にしない)。

| 端末 | テスト |
| --- | --- |
| PC | 窓をまたぐ `sync_ops`(偽の窓 2 つ)、`sql_batch` の巻き戻し(Rust)、`engine_lease` |
| スマホ | `Prefs.export` に同期の項目が入らない、`Prefs.applyRemote` が Compose の状態を変える |
| 両方 | 同期の対象の関数を画面から直接呼んでいないことの検査 |

## 11. 段階の見直し

`docs/sync-design.md` の「段階」が正。ここでは各段階の端末の作業を書く。

| 段階 | 端末の作業 | 完了の目安 |
| --- | --- | --- |
| 0 | 核 | 済み |
| 1 | `018_sync.sql`、`sql_batch`、`UserOps` の `favorite_thread_*`、アダプター 1 種類、エンジン(手動)、偽サーバー、テストの枠 | 済み。偽サーバーで PC と スマホがお気に入りのスレを往復する。本番の鍵保管・HTTP・板の判定(`BoardResolver`)はまだつないでいない |
| 2 | なし(サーバーの段階) | 済み |
| 3 | 許可証を送る形(`SyncApi.createSpace`・`pair`・`setTicket`)、スマホの PoW、偽サーバーの同じ規則 | シナリオ 54〜59 が PC とスマホで同じ結果 |
| 4 | HTTP の実装、鍵の保管、許可証の窓、手動の同期ボタン、開発用の設定に隠したペアリング。お気に入りのスレだけ。画面の入口は `SyncController`(`packages/sync/src/engine/controller.ts`・`SyncController.kt`)。言葉と QR は `sync-ui.json`・`sync-qr.json` で揃える | 検証用の Worker で 2 台が実機で同期する。PC とエミュレーターでは通した。実機は未確認 |
| 5 | 全部の種類、初回の同期、自動の同期(`SyncScheduler`)、状態と要約の表示、容量超過で外す処理は済み | 全シナリオ。件数の多い合流。実機の確認は残り |
| 6 | 試験の説明と同意、満員の表示、実際のウィジェット。枠 2 のシミュレーターにエンジンをつなぐ。検証環境で枠 2 にして PC とスマホのエミュレーターで通す | 限定の試験の前の条件を満たす |
| 7 | 公開の案内 | 公開の前の条件 |
| 8 | ローテーション、リカバリーコード(権限系のスイッチは済み) | `sync-design.md` の検証の全部 |

## 12. 難しい点と未解決

決定: `read_reset` は容量超過で外さない。外すと、消したログの既読が戻ることがあるため。`schema_version` は公開まで 1 のままとする。


### 危ない所(順に)

1. **更新の入口が多く、画面から直接呼んでいる。** 取りこぼすと端末間でずれ、余計に拾うと消えるべきでないものが消える。名前付きの操作と静的な検査、起動時の照合で守る。App.tsx は 2,900 行を超え、写しの Web もある
2. **PC でトランザクションが使えない。** `sql_batch` が前提。ここが崩れると「更新できたのに送らない」が起きる
3. **既読の見え方。** `read_no` が同期で下がるのは初めての動き。`markRead` の `MAX`・`useThreadScroll` の `sent`・未読の線の 3 か所の前提に触れる。読んでいる画面で事故が起きると一番目立つ
4. **「ログの削除」の意味が変わる。** 履歴から消す操作がログの削除しかない。ログの削除は全端末を未読に戻すので、まとめて消すとスレの数だけリセットが増え、容量と送信を使う
5. **容量。** 2 台 10MB で約 6,500 スレ。閲覧履歴の量が多い人はすぐ超える。`trim` は 90 日まで容量を空けない。
   押し出しのたびに全件を送り直すので、大きな領域ほど作り直しが重い
6. **DB の入れ替えと端末の複製。** `device_id` の重複は `read_dev` を静かに壊す
7. **時計。** 種まきの壁時計 1 と、未来の HLC は仕様のとおりだが、実機で見ないと分からない動きがある
8. **板の移転。** `eagle.5ch.io/x/` から別のサーバーへ移ると別のレコードになる。5ch の板の移転はある。お気に入りが 2 つになることがある
9. **Web の写し。** `App.tsx`・`ui/settings.ts` を Web に写すとき、`useSync`・`UserOps` を `WEB` で無効にする
10. **PC の鍵が WebView に入る。** 核が TypeScript なので避けられない
11. **90 日以上オフラインの端末。** 領域の作り直しのあとに戻ると、他の端末で期限切れになった tombstone を知らないので、削除済みの項目を生きた値として送ることがある(U14)
12. **通信の増加の間接の影響。** 同期で増えた履歴の行は `historyCheckMin` の確認の対象になり、掲示板へのスレ一覧の取得が増える。板ごとに 1 回なので上限はあるが、多い人では目に見える

### 規模の見積もり

| 場所 | 新しいファイル | 行数の目安 | 難所 |
| --- | --- | --- | --- |
| `packages/logstore` | 2(SQL・`userOps`) | 300 | |
| `packages/sync`(engine・adapters・client) | 10 前後 | 1,800 | リベース、順序、合流 |
| `apps/desktop` の TS | 4(`useSync`・host・設定の画面) | 700 + 既存 43 か所の変更 | 開いている画面の反映 |
| `apps/desktop` の Rust | 2(`sql_batch`・鍵) | 200 | 窓のチェック、閉じるとき |
| `apps/android/.../sync` | 12 前後 | 2,000 | `Prefs` の口、`AppViewModel` との分担 |
| `AppViewModel`・`Prefs`・`LogDb` の変更 | 0 | 既存 51 か所 | |
| `packages/conformance` と枠 | 3 | 53 シナリオ + 両方の実行部 400 | 共通の偽の DB |

合計は端末側でおよそ 5,500 行。実測ではなく見積もり。

### 未解決

| 番号 | 内容 | 案 | 期限 |
| --- | --- | --- | --- |
| U1 | ログを消したスレを開き直すと既読が戻るか | **決定: 戻らない。** ログの削除は全端末で削除。自動整理のあとは戻す |
| U2 | 限定の試験の既定の URL を `workers.dev` のままにするか | `docs/sync-design.md` の未決事項 | 段階 6 |
| U3 | サイトを同期するか | **決定: する。** お気に入りの板とスレも同期する |
| U4 | 手の「自分のレス」の印 | **決定: 同期する。** `own_post`(書き込みで付いた印と同じレコード) |
| U5 | スマホのスレ立てが書き込み履歴に入らない | PC に合わせて入れる(別の担当と相談) | 段階 5 |
| U6 | AI NG の条件と手の印 | 同期しない | 段階 8 の後 |
| U7 | 「未読に戻す」を画面に足すか | **決定: 足さない。** ログの削除が兼ねる |
| U8 | 配色と字の大きさを同期するか | **決定: しない。** |
| U9 | 離脱した端末の `read_dev` を片づけるか | まず残す | 段階 8 |
| U11 | 書き込みの本文を同期するか | **決定: する。** |
| U13 | 領域が消えたときに枠が満員で、押し出せる領域もないと作り直せない | 手元は残る。9 章の文言で案内し、前面に来るたび試す。消された領域の持ち主を優先する仕組みは作らない(見分ける情報を持たないため) | 段階 6 |
| U15 | Turnstile を入れると、確認なしの作り直しで人の操作が要る | **解決: 領域の作成の許可証。** 使い始めに 1 度 Turnstile を通し、`space_id` に結び付いた署名つきの許可証を受け取る。作り直しは同じ許可証で人の操作なしに行う。サーバーは保存しないので、消えた領域の控えが要らない(`docs/sync-design.md` の「許可証」) |
| U14 | 90 日以上オフラインの端末の復活 | 受け入れる。`last_pull_at` が 90 日より古い端末は合流の前に確認を出す案がある | 段階 6 |

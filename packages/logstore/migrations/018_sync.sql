-- 同期の表。追加だけで、既存の表の行と列を変えない。同期を使うまで中身は空のまま

-- レコードの最新の状態。本文は payload(知らないフィールドも含むキーを並べた JSON)が正で、ほかの列は引くための写し
CREATE TABLE sync_records (
  record_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  kind_tag TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  hlc TEXT NOT NULL,
  -- 暗号文の中の値。サーバーの平文の deleted は使わない
  deleted INTEGER NOT NULL DEFAULT 0,
  -- サーバーで最後に見た version。0 は未同期
  version INTEGER NOT NULL DEFAULT 0,
  pending INTEGER NOT NULL DEFAULT 0,
  -- 送る順。小さいほど先
  priority INTEGER NOT NULL DEFAULT 5,
  -- 今のデータへまだ写していない
  needs_apply INTEGER NOT NULL DEFAULT 0,
  -- 正規化した板 URL
  ref_board TEXT,
  ref_thread TEXT,
  ref_detail TEXT,
  ref_local INTEGER,
  -- この端末で tombstone になった時刻(ms)。90 日保持の起点
  tomb_at INTEGER
) WITHOUT ROWID;
CREATE INDEX sync_records_thread ON sync_records (kind, ref_board, ref_thread);
CREATE INDEX sync_records_pending ON sync_records (priority, hlc) WHERE pending = 1;
CREATE INDEX sync_records_apply ON sync_records (kind) WHERE needs_apply = 1;

-- 利用者の操作の記録。データの更新と同じトランザクションで積む。エンジンだけが消す
CREATE TABLE sync_ops (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  op TEXT NOT NULL,
  -- 同じものをまとめる鍵(既読はスレ)。まとめないものは seq ごとに別の値
  target TEXT NOT NULL,
  num INTEGER,
  args TEXT,
  at_ms INTEGER NOT NULL
);
-- 既読は同じスレを 1 行にまとめる。スクロールのたびに行を増やさない
CREATE UNIQUE INDEX sync_ops_read ON sync_ops (op, target) WHERE op = 'read';

-- 同期の状態(1 項目 1 行)。秘密は置かない。settings 表に入れない(書き出しに混ざるので)
CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;

-- URL の揺れを吸収するとき、スレをキーで引く
CREATE INDEX threads_key ON threads (key);

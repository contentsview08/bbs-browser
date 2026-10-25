-- 自動 NG(荒らしの判定)にユーザーが付けた印。本文の鍵(apps/desktop/src/utils/autoNg.ts の bodyKey)ごとに 1 行。
-- label: 1 は荒らし、0 は荒らしじゃない(自動 NG の誤判定)。
-- 本文・板・付けたときの自動 NG の理由も残し、あとで判定モデルを育てる材料にする
CREATE TABLE troll_marks (
  body_key TEXT PRIMARY KEY,
  label INTEGER NOT NULL,
  body TEXT NOT NULL,
  board_url TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;

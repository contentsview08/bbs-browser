-- 自分の書き込み。自分のレスに印を付け、自分へのアンカーを見分けるために使う
CREATE TABLE own_posts (
  board_url TEXT NOT NULL,
  key TEXT NOT NULL,
  no INTEGER NOT NULL,
  posted_at INTEGER NOT NULL,
  PRIMARY KEY (board_url, key, no)
) WITHOUT ROWID;

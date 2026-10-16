-- 書き込みの下書き。スレごとに書きかけの本文を覚えておき、タブを閉じても・アプリを閉じても残す。
-- 書き込めたら消す
CREATE TABLE drafts (
  board_url TEXT NOT NULL,
  key TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (board_url, key)
) WITHOUT ROWID;

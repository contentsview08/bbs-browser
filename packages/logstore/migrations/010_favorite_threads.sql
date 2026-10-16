-- お気に入りのスレ。スレのログを消しても残す(threads とは別に持ち、開き直せるだけの情報を入れておく)
CREATE TABLE favorite_threads (
  board_url TEXT NOT NULL,
  key TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at INTEGER,
  sort INTEGER NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (board_url, key)
) WITHOUT ROWID;

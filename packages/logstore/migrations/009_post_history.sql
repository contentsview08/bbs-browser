-- 書き込み履歴。書き込んだ内容そのものを残す(スレのログを消しても残るように、own_posts とは別に持つ)。
-- no はレス番号が分からなかったときは NULL
CREATE TABLE post_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connector_id TEXT NOT NULL,
  board_url TEXT NOT NULL,
  key TEXT NOT NULL,
  thread_title TEXT NOT NULL,
  no INTEGER,
  name TEXT NOT NULL,
  mail TEXT NOT NULL,
  body TEXT NOT NULL,
  posted_at INTEGER NOT NULL
);
CREATE INDEX post_history_posted_at ON post_history (posted_at);

-- これまでの「自分の書き込み」を、ログに残っている本文ごと移しておく
INSERT INTO post_history (connector_id, board_url, key, thread_title, no, name, mail, body, posted_at)
SELECT t.connector_id, o.board_url, o.key, t.title, o.no, COALESCE(p.name, ''), COALESCE(p.mail, ''), COALESCE(p.body, ''), o.posted_at
FROM own_posts AS o
JOIN threads AS t ON t.board_url = o.board_url AND t.key = o.key
LEFT JOIN posts AS p ON p.board_url = o.board_url AND p.key = o.key AND p.no = o.no
ORDER BY o.posted_at;

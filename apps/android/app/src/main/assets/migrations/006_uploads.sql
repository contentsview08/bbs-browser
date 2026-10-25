-- 画像のアップロード履歴。匿名で上げた catbox のファイルはサーバー上では消せないので、
-- ここから消しても、アプリの履歴から消えるだけ
CREATE TABLE uploads (
  url TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_at INTEGER NOT NULL
);

CREATE INDEX uploads_uploaded_at ON uploads (uploaded_at);

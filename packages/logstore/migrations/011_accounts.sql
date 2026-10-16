-- サイトのアカウント(5ch の BE など)。パスワードもそのまま入れる
-- (Linux では OS の資格情報ストアがあるとは限らないため、DB に置くと決めた)。
-- 設定の JSON 書き出しには入らないが、DB のまるごとバックアップには入る
CREATE TABLE accounts (
  connector_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  user TEXT NOT NULL,
  password TEXT NOT NULL,
  -- 起動したときに自動でログインする
  auto_login INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (connector_id, account_id)
) WITHOUT ROWID;

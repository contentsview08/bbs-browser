-- ログ保存の初期スキーマ。
-- アプリでは Rust 側(tauri-plugin-sql のマイグレーション)が、テストでは vitest がこのファイルを読む。

-- 板一覧の取得元(bbsmenu)
CREATE TABLE sites (
  menu_url TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

INSERT INTO sites (menu_url, connector_id, name, sort)
VALUES ('https://menu.5ch.io/bbsmenu.json', '2ch-compat', '5ch', 0);

-- 板一覧のキャッシュ(起動時にすぐ出すため)
CREATE TABLE boards (
  site_menu_url TEXT NOT NULL,
  url TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  sort INTEGER NOT NULL,
  PRIMARY KEY (site_menu_url, url)
);

-- 一度でも開いたスレ
CREATE TABLE threads (
  board_url TEXT NOT NULL,
  key TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  title TEXT NOT NULL,
  -- 手元に保存してあるレス数
  post_count INTEGER NOT NULL DEFAULT 0,
  -- どこまで読んだか(レス番号)
  read_no INTEGER NOT NULL DEFAULT 0,
  -- コネクタの Cursor を JSON にしたもの。NULL なら次の取得は全件
  cursor TEXT,
  -- active / archived(dat 落ち)
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER,
  fetched_at INTEGER,
  read_at INTEGER,
  PRIMARY KEY (board_url, key)
);

CREATE INDEX threads_read_at ON threads (read_at);

CREATE TABLE posts (
  board_url TEXT NOT NULL,
  key TEXT NOT NULL,
  no INTEGER NOT NULL,
  name TEXT NOT NULL,
  mail TEXT NOT NULL,
  date TEXT NOT NULL,
  id TEXT,
  body TEXT NOT NULL,
  PRIMARY KEY (board_url, key, no)
) WITHOUT ROWID;

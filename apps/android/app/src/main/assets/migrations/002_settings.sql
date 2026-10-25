-- 表示設定などのアプリ設定。値は JSON 文字列で持つ
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

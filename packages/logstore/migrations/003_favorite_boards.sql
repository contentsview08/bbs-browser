-- お気に入り板。bbsmenu を公開していない板(eddibb など)も、URL で直接ここに登録する
CREATE TABLE favorite_boards (
  url TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

INSERT INTO favorite_boards (url, connector_id, name, sort)
VALUES ('https://bbs.eddibb.cc/liveedge/', '2ch-compat', 'エッヂ', 0);

-- ファビコンのキャッシュ。画像そのものを data: URL で持ち、起動のたびに取りに行かないようにする。
-- key は、自動で探したものは板の URL、設定で上書きしたものは画像の URL
CREATE TABLE favicons (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

-- お気に入り板の並べ替えは sort を使う(001 で作った列)。並びを書き戻しやすいよう、いまの並びで振り直しておく
UPDATE favorite_boards
SET sort = (SELECT COUNT(*) FROM favorite_boards AS f WHERE f.sort < favorite_boards.sort OR (f.sort = favorite_boards.sort AND f.name < favorite_boards.name));

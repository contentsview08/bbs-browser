-- リンクのプレビュー(OGP)のキャッシュ。起動のたびに同じページを取りに行かないようにする。
-- data は Ogp を JSON にしたもの。何も取れなかったページは NULL にして、しばらく取り直さない
CREATE TABLE ogp_cache (
  url TEXT PRIMARY KEY,
  data TEXT,
  fetched_at INTEGER NOT NULL
);

-- 上げた画像の中身のハッシュ(SHA-256 の 16 進)。同じ画像をもう一度貼ったら、上げずに前の URL を使う
ALTER TABLE uploads ADD COLUMN hash TEXT;
CREATE INDEX uploads_hash ON uploads (hash);

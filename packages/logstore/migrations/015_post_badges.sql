-- 掲示板がレスに付けた印(「管理人」「認証済み」など。Post.badges)。JSON の配列で入れる。印のないレスは NULL
ALTER TABLE posts ADD COLUMN badges TEXT;

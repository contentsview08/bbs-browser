-- レスの、板の本当の番号(ふたば・4chan のように、スレの中の番号 no と違う掲示板だけ入れる。2ch は NULL)
ALTER TABLE posts ADD COLUMN ref INTEGER;

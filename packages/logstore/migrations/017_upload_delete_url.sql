-- 上げた画像を置き場から消すためのページの URL(imgbb の delete_url)。開いて消す。ないものは置き場では消せない
ALTER TABLE uploads ADD COLUMN delete_url TEXT;

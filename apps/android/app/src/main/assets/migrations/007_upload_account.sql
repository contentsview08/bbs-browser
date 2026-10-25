-- catbox のアカウント(userhash)で上げたか。アカウントで上げたものだけ、サーバー上でも消せる
ALTER TABLE uploads ADD COLUMN with_account INTEGER NOT NULL DEFAULT 0;

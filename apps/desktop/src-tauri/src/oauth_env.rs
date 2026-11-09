//! Google の OAuth クライアント(ID とシークレット)をビルドのときに受け取る。build.rs とテストが同じものを使う。
//! 値はリポジトリに置かない。環境変数か、環境変数 OBB_GOOGLE_OAUTH_FILE が指す KEY=VALUE のファイルから読む

pub const ID_KEY: &str = "OBB_GOOGLE_CLIENT_ID";
pub const SECRET_KEY: &str = "OBB_GOOGLE_CLIENT_SECRET";
pub const FILE_KEY: &str = "OBB_GOOGLE_OAUTH_FILE";

/// KEY=VALUE の行から値を探す。# の行と空の行は飛ばす。Windows で作ったファイル(CRLF・BOM)と、値の両端の引用符も受ける
pub fn find_value(text: &str, key: &str) -> Option<String> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((k, v)) = line.split_once('=') else { continue };
        if k.trim() != key {
            continue;
        }
        let v = v.trim();
        let v = ['"', '\''].iter().find_map(|q| v.strip_prefix(*q).and_then(|x| x.strip_suffix(*q))).unwrap_or(v);
        return (!v.is_empty()).then(|| v.to_string());
    }
    None
}

/// 環境変数の ID・シークレットを先に見る。どちらかが欠けたらファイルを見る。両方そろわなければ None(Google の同期のないビルド)
pub fn resolve(env: impl Fn(&str) -> Option<String>, read: impl Fn(&str) -> Option<String>) -> Option<(String, String)> {
    let nonempty = |k: &str| env(k).map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    if let (Some(id), Some(secret)) = (nonempty(ID_KEY), nonempty(SECRET_KEY)) {
        return Some((id, secret));
    }
    let text = read(&nonempty(FILE_KEY)?)?;
    Some((find_value(&text, ID_KEY)?, find_value(&text, SECRET_KEY)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ファイルの行を読む() {
        let text = "\u{feff}# コメント\r\nOBB_GOOGLE_CLIENT_ID=abc.apps.googleusercontent.com\r\n\r\n  OBB_GOOGLE_CLIENT_SECRET = \"s=1\" \r\n";
        assert_eq!(find_value(text, ID_KEY).as_deref(), Some("abc.apps.googleusercontent.com"));
        assert_eq!(find_value(text, SECRET_KEY).as_deref(), Some("s=1"));
        assert_eq!(find_value("#OBB_GOOGLE_CLIENT_ID=x\nOBB_GOOGLE_CLIENT_ID_OLD=y\n", ID_KEY), None);
        assert_eq!(find_value("export OBB_GOOGLE_CLIENT_ID='q'\n", ID_KEY).as_deref(), Some("q"));
        assert_eq!(find_value("OBB_GOOGLE_CLIENT_ID=\n", ID_KEY), None);
    }

    #[test]
    fn 環境変数を先に見て_なければファイル_どちらもなければなし() {
        let env = |pairs: &'static [(&'static str, &'static str)]| move |k: &str| pairs.iter().find(|(a, _)| *a == k).map(|(_, v)| v.to_string());
        let file = |p: &str| (p == "f.env").then(|| "OBB_GOOGLE_CLIENT_ID=fid\nOBB_GOOGLE_CLIENT_SECRET=fsec\n".to_string());
        assert_eq!(resolve(env(&[(ID_KEY, "eid"), (SECRET_KEY, "esec"), (FILE_KEY, "f.env")]), file), Some(("eid".into(), "esec".into())));
        assert_eq!(resolve(env(&[(ID_KEY, "eid"), (FILE_KEY, "f.env")]), file), Some(("fid".into(), "fsec".into())));
        assert_eq!(resolve(env(&[(FILE_KEY, "none.env")]), file), None);
        assert_eq!(resolve(env(&[(ID_KEY, "eid")]), file), None);
        assert_eq!(resolve(env(&[(ID_KEY, " "), (SECRET_KEY, "x")]), file), None);
    }
}

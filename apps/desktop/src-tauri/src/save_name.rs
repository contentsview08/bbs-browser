//! 画像の保存先の書き方(例 `{site}/{board}/{filename}`)を、保存するフォルダとファイル名にする。
//! 区切りは書き方の `/` だけで、最後の `/` の後ろがファイル名。拡張子はいつも中身の形式のものを付ける。
//! 決まりはスマホ版の data/SaveName.kt と同じ。試験は packages/conformance/save-name.json

use serde::Deserialize;

/// 分からない値(スレの外で開いた画像の板など)
pub const UNKNOWN: &str = "不明";
/// フォルダ 1 つの名前の長さの上限(バイト)。深いフォルダでパスが長くなりすぎないよう、ファイル名より短くする
const MAX_DIR_BYTES: usize = 120;
/// ファイル名の、拡張子を除いた長さの上限。ファイル名の上限は 255(「 (1)」と拡張子の分を残す)
pub const MAX_STEM_BYTES: usize = 200;

/// 保存のときに分かっていること。分からないものは None
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SaveVars {
    pub board_url: Option<String>,
    /// 掲示板の名前(BBS メニューの名前)。なければホスト名
    pub site: Option<String>,
    pub board: Option<String>,
    pub thread: Option<String>,
    pub thread_key: Option<String>,
    pub no: Option<u32>,
    /// 保存した時刻(その端末の時計)。年・月・日・時・分・秒
    pub time: [u32; 6],
    pub unix: i64,
}

/// %XX を元の文字に戻す。UTF-8 でない並びは置換文字にし、%XX の形でないものはそのまま残す
pub fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = (bytes[i] == b'%').then(|| bytes.get(i + 1..i + 3)).flatten().and_then(|h| {
            let hi = (h[0] as char).to_digit(16)?;
            let lo = (h[1] as char).to_digit(16)?;
            Some((hi * 16 + lo) as u8)
        });
        if let Some(b) = hex {
            out.push(b);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// 長さを max バイト以内に切る(文字の途中では切らない)
fn truncate_bytes(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let end = (0..=max).rev().find(|&i| s.is_char_boundary(i)).unwrap_or(0);
    &s[..end]
}

/// URL の最後の部分(? と # の前)。なければ空
fn last_segment(url: &str) -> &str {
    let path = url.split(['?', '#']).next().unwrap_or(url);
    path.rsplit('/').find(|s| !s.is_empty()).unwrap_or("")
}

/// 画像の URL の最後の部分の、拡張子を除いた名前(%XX は戻す)。空なら image
pub fn name_of(url: &str) -> String {
    let last = percent_decode(last_segment(url));
    let stem = last.rsplit_once('.').map_or(last.as_str(), |(s, _)| s);
    if stem.is_empty() { "image".into() } else { stem.into() }
}

/// 板の URL のホスト名(小文字。利用者名とポートは外す)
fn host_of(url: &str) -> Option<String> {
    let rest = url.split_once("://")?.1;
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = authority.rsplit('@').next().unwrap_or("");
    let host = match host.rsplit_once(':') {
        Some((h, port)) if port.chars().all(|c| c.is_ascii_digit()) => h,
        _ => host,
    };
    (!host.is_empty()).then(|| host.to_ascii_lowercase())
}

/// 板の URL の最後の部分(例 https://bbs.eddibb.cc/liveedge/ → liveedge)
fn board_key_of(url: &str) -> Option<String> {
    let rest = url.split_once("://")?.1;
    let path = rest.split_once('/').map_or("", |(_, p)| p);
    let last = last_segment(path);
    (!last.is_empty()).then(|| percent_decode(last))
}

fn known(v: &Option<String>) -> Option<&str> {
    v.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

/// 変数の値。知らない名前は None(書いたまま残す)
fn value_of(name: &str, url: &str, ext: &str, v: &SaveVars) -> Option<String> {
    let host = v.board_url.as_deref().and_then(host_of);
    let or_unknown = |s: Option<&str>| s.unwrap_or(UNKNOWN).to_string();
    let [y, mo, d, h, mi, s] = v.time;
    Some(match name {
        "name" => name_of(url),
        "ext" => ext.into(),
        "filename" => format!("{}.{ext}", name_of(url)),
        "site" => or_unknown(known(&v.site).or(host.as_deref())),
        "host" => or_unknown(host.as_deref()),
        "board" => or_unknown(known(&v.board)),
        "boardKey" => or_unknown(v.board_url.as_deref().and_then(board_key_of).as_deref()),
        "thread" => or_unknown(known(&v.thread)),
        "threadKey" => or_unknown(known(&v.thread_key)),
        "no" => v.no.map_or(UNKNOWN.into(), |n| n.to_string()),
        "yyyy" => format!("{y:04}"),
        "mm" => format!("{mo:02}"),
        "dd" => format!("{d:02}"),
        "HH" => format!("{h:02}"),
        "MM" => format!("{mi:02}"),
        "SS" => format!("{s:02}"),
        "unix" => v.unix.to_string(),
        _ => return None,
    })
}

/// {名前} を値に置き換える。知らない名前はそのまま残す
fn substitute(template: &str, url: &str, ext: &str, v: &SaveVars) -> String {
    let mut out = String::new();
    let mut rest = template;
    while let Some(open) = rest.find('{') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        let name_len = after.find(|c: char| !c.is_ascii_alphabetic()).unwrap_or(after.len());
        let value = (after[name_len..].starts_with('}')).then(|| value_of(&after[..name_len], url, ext, v)).flatten();
        match value {
            Some(value) => {
                out.push_str(&value);
                rest = &after[name_len + 1..];
            }
            None => {
                out.push('{');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Windows で使えない文字・制御文字・文字の向きを変える文字は _ にする(値に / が入っても、フォルダは増えない)
fn replace_bad(s: &str) -> String {
    s.chars()
        .map(|c| {
            let bidi = matches!(c, '\u{200E}' | '\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}');
            if "\\/:*?\"<>|".contains(c) || c.is_control() || bidi { '_' } else { c }
        })
        .collect()
}

/// 先頭・末尾の空白とピリオドを外す(「..」で外へ出ない・Windows で末尾のピリオドが消えて名前が変わらない)
fn trim_edges(s: &str) -> &str {
    s.trim_matches([' ', '\u{3000}', '.'])
}

/// CON・NUL・COM1 などの名前は Windows で作れない
fn is_reserved(s: &str) -> bool {
    let device = s.split('.').next().unwrap_or("").to_ascii_uppercase();
    matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (device.len() == 4 && (device.starts_with("COM") || device.starts_with("LPT")) && device.ends_with(|c: char| c.is_ascii_digit()))
}

/// フォルダ 1 つ・ファイル名の幹を、作れる名前にする。空になれば空
fn clean_part(s: &str, max: usize) -> String {
    let replaced = replace_bad(s);
    let cut = trim_edges(truncate_bytes(trim_edges(&replaced), max));
    if is_reserved(cut) { format!("_{cut}") } else { cut.to_string() }
}

/// ext で終わっていれば外す(大文字・小文字は見ない)
fn strip_ext<'a>(s: &'a str, ext: &str) -> &'a str {
    let dot_ext = format!(".{ext}");
    if s.len() >= dot_ext.len() && s.is_char_boundary(s.len() - dot_ext.len()) && s[s.len() - dot_ext.len()..].eq_ignore_ascii_case(&dot_ext) {
        &s[..s.len() - dot_ext.len()]
    } else {
        s
    }
}

/// 書き方から、保存するフォルダ(土台からの並び)とファイル名を作る。最後の要素がファイル名。
/// ext は中身から見分けた拡張子(書き方に {ext} がなくても付ける)
pub fn save_path(pattern: &str, url: &str, ext: &str, v: &SaveVars) -> Vec<String> {
    let parts: Vec<&str> = pattern.split(['/', '\\']).collect();
    let (file, dirs) = parts.split_last().expect("split は 1 つ以上返す");
    let mut out: Vec<String> = dirs
        .iter()
        .map(|d| clean_part(&substitute(d, url, ext, v), MAX_DIR_BYTES))
        .filter(|d| !d.is_empty())
        .collect();
    let replaced = replace_bad(&substitute(file, url, ext, v));
    let mut stem = clean_part(strip_ext(&replaced, ext), MAX_STEM_BYTES);
    if stem.is_empty() {
        stem = clean_part(&name_of(url), MAX_STEM_BYTES);
    }
    if stem.is_empty() {
        stem = "image".into();
    }
    out.push(format!("{stem}.{ext}"));
    out
}

/// 同じ名前があるときの n 番目の名前(「名前 (1).jpg」)
pub fn numbered_name(name: &str, n: u32) -> String {
    if n == 0 {
        return name.into();
    }
    match name.rfind('.') {
        Some(i) if i > 0 => format!("{} ({n}){}", &name[..i], &name[i..]),
        _ => format!("{name} ({n})"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    /// 試験の時刻 "2026-11-11 09:05:03" を数に
    fn time_of(s: &str) -> [u32; 6] {
        let n: Vec<u32> = s.split(['-', ' ', ':']).map(|x| x.parse().unwrap()).collect();
        [n[0], n[1], n[2], n[3], n[4], n[5]]
    }

    #[test]
    fn conformance() {
        let cases: Vec<Value> = serde_json::from_str(include_str!("../../../../packages/conformance/save-name.json")).unwrap();
        for c in cases {
            let i = &c["input"];
            let got = if let Some(n) = i.get("numbered") {
                numbered_name(n["name"].as_str().unwrap(), n["n"].as_u64().unwrap() as u32)
            } else {
                let mut v: SaveVars = serde_json::from_value(i["vars"].clone()).unwrap_or_default();
                v.time = time_of(i["time"].as_str().unwrap_or("2026-11-11 09:05:03"));
                v.unix = i["unix"].as_i64().unwrap_or(1_794_355_503);
                save_path(i["pattern"].as_str().unwrap(), i["url"].as_str().unwrap(), i["ext"].as_str().unwrap(), &v).join("/")
            };
            assert_eq!(got, c["expected"].as_str().unwrap(), "{}", c["name"]);
        }
    }
}

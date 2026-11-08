//! 書き込み(bbs.cgi)とアカウントのログインのための通信。Cookie はこのアプリが自分で持つ。
//!
//! plugin-http の Cookie 置き場は、アプリから中身を見たり一部を外したりできず、
//! Cookie ヘッダーを手で付けると置き場の Cookie が付かなくなる(reqwest の決まり)。
//! 書き込みごとに「BE の Cookie を付けるか」を選べるよう、書き込みの通信はここで行い、
//! Cookie は自前の置き場(アプリのデータフォルダの post-cookies.json)に持つ。
//! 途中のリダイレクトで渡される Cookie(ログインなど)も取りこぼさないよう、リダイレクトも自分でたどる。

use std::collections::HashMap;
use std::io::BufReader;
use std::path::PathBuf;
use std::sync::Mutex;

use cookie_store::CookieStore;
use tauri::Url;
use tauri_plugin_http::reqwest;

const COOKIE_FILE: &str = "post-cookies.json";
const MAX_REDIRECTS: usize = 5;

pub struct PostCookies {
    store: Mutex<CookieStore>,
    path: PathBuf,
}

impl PostCookies {
    /// 保存してある Cookie を読む(なければ空)
    pub fn load(app: &tauri::AppHandle) -> Self {
        let dir = crate::data_dir(app).map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("."));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join(COOKIE_FILE);
        let store = std::fs::File::open(&path)
            .ok()
            .and_then(|f| cookie_store::serde::json::load_all(BufReader::new(f)).ok())
            .unwrap_or_default();
        Self { store: Mutex::new(store), path }
    }

    /// 期限のない Cookie(ブラウザを閉じたら消えるもの)も含めて保存する。次に起動したときも書き込みの認証が続くように。
    /// 一時ファイルに書いてから置き換える(途中で落ちて壊れたファイルは、次の起動で黙って空として読まれ、認証が全部消える)
    fn save(&self, store: &CookieStore) {
        let mut json = Vec::new();
        if cookie_store::serde::json::save_incl_expired_and_nonpersistent(store, &mut json).is_err() {
            return;
        }
        let tmp = self.path.with_extension("tmp");
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, &self.path);
        }
    }
}

/// リダイレクトの次の一歩。決まりは packages/conformance/post-redirect.json(スマホ版の data/Http.kt の nextRequest と同じ)
#[derive(Debug)]
struct NextRequest {
    url: Url,
    /// 同じ方法と本文で送り直す(307・308)。false なら本文なしの GET
    keep_method: bool,
    /// false なら User-Agent のほかは渡さない(別のサイトへ行くとき)
    keep_headers: bool,
}

/// たどらないなら None(受けた応答をそのまま返す)
fn next_request(status: u16, from: &Url, location: Option<&str>) -> Option<NextRequest> {
    if !matches!(status, 301 | 302 | 303 | 307 | 308) {
        return None;
    }
    let next = from.join(location.filter(|l| !l.is_empty())?).ok()?;
    let (from_https, next_https) = (from.scheme() == "https", next.scheme() == "https");
    // https から http へは落とさない
    if !matches!(next.scheme(), "http" | "https") || (from_https && !next_https) {
        return None;
    }
    let upgrade = !from_https && next_https && from.port().is_none() && next.port().is_none();
    let same_site = from.host_str() == next.host_str() && (from.port_or_known_default() == next.port_or_known_default() || upgrade);
    let resend = matches!(status, 307 | 308);
    // 本文を別のサイトへ渡さない
    if resend && !same_site {
        return None;
    }
    Some(NextRequest { url: next, keep_method: resend, keep_headers: same_site })
}

#[derive(serde::Serialize)]
pub struct PostResponse {
    status: u16,
    /// ヘッダー名は小文字
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

/// POST する。exclude_cookies に挙げた名前の Cookie は付けない(BE を使わない書き込みなど)
#[tauri::command]
pub async fn http_post(
    state: tauri::State<'_, PostCookies>,
    url: String,
    body: String,
    headers: HashMap<String, String>,
    exclude_cookies: Vec<String>,
) -> Result<PostResponse, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        // 返事のないサーバーで、書き込みが止まったままにならないように
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let mut url = Url::parse(&url).map_err(|e| e.to_string())?;
    // http の URL も先に https で送る。つながらないときだけ http に戻す(届いたあとの失敗で送り直すと二重投稿になる)
    let mut http_fallback = None;
    if url.scheme() == "http" {
        let mut https = url.clone();
        if https.set_scheme("https").is_ok() {
            http_fallback = Some(std::mem::replace(&mut url, https));
        }
    }
    let mut method = reqwest::Method::POST;
    let mut body = Some(body);
    let mut keep_headers = true;

    for _ in 0..=MAX_REDIRECTS {
        let cookie = {
            let store = state.store.lock().map_err(|e| e.to_string())?;
            store
                .get_request_values(&url)
                .filter(|(name, _)| !exclude_cookies.iter().any(|x| x == name))
                .map(|(name, value)| format!("{name}={value}"))
                .collect::<Vec<_>>()
                .join("; ")
        };
        let mut req = client.request(method.clone(), url.clone());
        for (k, v) in &headers {
            let content_type_without_body = body.is_none() && k.eq_ignore_ascii_case("content-type");
            if (keep_headers || k.eq_ignore_ascii_case("user-agent")) && !content_type_without_body {
                req = req.header(k, v);
            }
        }
        if !cookie.is_empty() {
            req = req.header(reqwest::header::COOKIE, cookie);
        }
        if let Some(b) = &body {
            req = req.body(b.clone());
        }
        let res = match req.send().await {
            Ok(res) => res,
            Err(e) if e.is_connect() && http_fallback.is_some() => {
                url = http_fallback.take().unwrap_or(url);
                continue;
            }
            Err(e) => return Err(e.to_string()),
        };
        http_fallback = None;

        // 受け取った Cookie を置き場に入れる(リダイレクトの途中のものも)
        {
            let mut store = state.store.lock().map_err(|e| e.to_string())?;
            for value in res.headers().get_all(reqwest::header::SET_COOKIE) {
                if let Ok(s) = value.to_str() {
                    let _ = store.parse(s, &url);
                }
            }
            state.save(&store);
        }

        let status = res.status();
        let location = res.headers().get(reqwest::header::LOCATION).and_then(|l| l.to_str().ok());
        if let Some(next) = next_request(status.as_u16(), &url, location) {
            url = next.url;
            keep_headers = next.keep_headers;
            // 303 と(慣習で)302・301 は GET で取り直す。307・308 は同じまま送り直す
            if !next.keep_method {
                method = reqwest::Method::GET;
                body = None;
            }
            continue;
        }

        let mut out_headers = HashMap::new();
        for (k, v) in res.headers() {
            if let Ok(s) = v.to_str() {
                out_headers.insert(k.as_str().to_lowercase(), s.to_string());
            }
        }
        let bytes = res.bytes().await.map_err(|e| e.to_string())?;
        return Ok(PostResponse { status: status.as_u16(), headers: out_headers, body: bytes.to_vec() });
    }
    Err("リダイレクトが多すぎます".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    /// knownDiff.pc があれば、それと比べる(差がなくなれば落ちて分かる)
    fn expected_of(c: &Value) -> &Value {
        c.get("knownDiff").and_then(|d| d.get("pc")).unwrap_or(&c["expected"])
    }

    fn cases(text: &str) -> Vec<Value> {
        serde_json::from_str(text).unwrap()
    }

    #[test]
    fn post_redirect() {
        for c in cases(include_str!("../../../../packages/conformance/post-redirect.json")) {
            let i = &c["input"];
            let from = Url::parse(i["url"].as_str().unwrap()).unwrap();
            let got = match next_request(i["status"].as_u64().unwrap() as u16, &from, i["location"].as_str()) {
                None => json!({ "follow": false }),
                Some(n) => json!({
                    "follow": true,
                    "url": n.url.as_str(),
                    "method": if n.keep_method { "POST" } else { "GET" },
                    "keepHeaders": n.keep_headers,
                }),
            };
            assert_eq!(&got, expected_of(&c), "{}", c["name"]);
        }
    }

    /// 保存して読み直した置き場(次に起動したとき)で、その URL に付くか
    #[test]
    fn cookie() {
        for c in cases(include_str!("../../../../packages/conformance/cookie.json")) {
            let i = &c["input"];
            let mut store = CookieStore::default();
            let _ = store.parse(i["setCookie"].as_str().unwrap(), &Url::parse(i["url"].as_str().unwrap()).unwrap());
            let mut saved = Vec::new();
            cookie_store::serde::json::save_incl_expired_and_nonpersistent(&store, &mut saved).unwrap();
            let restored = cookie_store::serde::json::load_all(BufReader::new(&saved[..])).unwrap();
            let sent = restored.get_request_values(&Url::parse(i["requestUrl"].as_str().unwrap()).unwrap()).next().is_some();
            assert_eq!(&json!(sent), expected_of(&c), "{}", c["name"]);
        }
    }
}

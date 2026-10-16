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
use tauri::{Manager, Url};
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
        let dir = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join(COOKIE_FILE);
        let store = std::fs::File::open(&path)
            .ok()
            .and_then(|f| cookie_store::serde::json::load_all(BufReader::new(f)).ok())
            .unwrap_or_default();
        Self { store: Mutex::new(store), path }
    }

    /// 期限のない Cookie(ブラウザを閉じたら消えるもの)も含めて保存する。次に起動したときも書き込みの認証が続くように
    fn save(&self, store: &CookieStore) {
        if let Ok(mut f) = std::fs::File::create(&self.path) {
            let _ = cookie_store::serde::json::save_incl_expired_and_nonpersistent(store, &mut f);
        }
    }
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
        .build()
        .map_err(|e| e.to_string())?;
    let mut url = Url::parse(&url).map_err(|e| e.to_string())?;
    let mut method = reqwest::Method::POST;
    let mut body = Some(body);

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
            req = req.header(k, v);
        }
        if !cookie.is_empty() {
            req = req.header(reqwest::header::COOKIE, cookie);
        }
        if let Some(b) = &body {
            req = req.body(b.clone());
        }
        let res = req.send().await.map_err(|e| e.to_string())?;

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
        if status.is_redirection() {
            if let Some(next) = res.headers().get(reqwest::header::LOCATION).and_then(|l| l.to_str().ok()) {
                url = url.join(next).map_err(|e| e.to_string())?;
                // 303 と(慣習で)302・301 は GET で取り直す。307・308 は同じまま送り直す
                if !matches!(status.as_u16(), 307 | 308) {
                    method = reqwest::Method::GET;
                    body = None;
                }
                continue;
            }
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

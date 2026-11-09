//! 同期サーバーとの通信。plugin-http ではなく専用の口にする。
//! plugin-http は掲示板の Cookie の置き場を共有し、全体の打ち切りと読み取りの上限を持たず、通信先も画面の許可の表(http を含む)任せになる。
//! サーバーは CORS を出さないので WebView の fetch は使えない。
//! リダイレクトをたどらない(トークンが別の先へ渡るため)。トークンと本文をログにも失敗の文にも入れない。

use std::collections::BTreeMap;
use std::sync::OnceLock;
use std::time::Duration;

use tauri::Url;

/// 要求全体の上限。遅い回線でも 1MB のページを読み切れるよう長めにし、止まったままの通信は無通信の打ち切りで切る
const TIMEOUT_MAX: Duration = Duration::from_secs(60);
/// 無通信の打ち切りの上限
const IDLE_MAX: Duration = Duration::from_secs(10);

#[derive(serde::Deserialize)]
pub struct SyncHttpRequest {
    method: String,
    url: String,
    headers: BTreeMap<String, String>,
    body: Option<String>,
    max_bytes: usize,
    timeout_ms: u64,
    /// 無通信の打ち切り(ms)。古い画面は送らないので、なければ 10 秒
    #[serde(default)]
    idle_timeout_ms: Option<u64>,
}

#[derive(serde::Serialize, Debug)]
pub struct SyncHttpResponse {
    status: u16,
    body: String,
}

/// https だけ。localhost の http は開発の版だけ
pub(crate) fn url_allowed(url: &Url, dev: bool) -> bool {
    match url.scheme() {
        "https" => url.host_str().is_some(),
        "http" => dev && matches!(url.host_str(), Some("localhost") | Some("127.0.0.1")),
        _ => false,
    }
}

/// 鍵と通信は main の窓だけが使う。権限は全窓で共通なので、ここで確かめる
pub(crate) fn only_main(window: &tauri::Window) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("not_allowed".into())
    }
}

fn client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<Result<reqwest::Client, ()>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            // UA はサーバー側の WAF で OBB の通信を見分けるのに使う(OBB/<版> で始める)
            reqwest::Client::builder()
                .user_agent(concat!("OBB/", env!("CARGO_PKG_VERSION"), " (sync)"))
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(TIMEOUT_MAX)
                .build()
                .map_err(|_| ())
        })
        .as_ref()
        .map_err(|_| "network".to_string())
}

async fn send(req: SyncHttpRequest, dev: bool) -> Result<SyncHttpResponse, String> {
    let url: Url = req.url.parse().map_err(|_| "bad_url".to_string())?;
    if !url_allowed(&url, dev) {
        return Err("bad_url".into());
    }
    let method = match req.method.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        // Drive の置き場の files.update
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        _ => return Err("bad_method".into()),
    };
    let timeout = Duration::from_millis(req.timeout_ms).min(TIMEOUT_MAX);
    let mut b = client()?.request(method, url).timeout(timeout);
    for (k, v) in &req.headers {
        b = b.header(k, v);
    }
    // 文字列の本文には reqwest が Content-Length を付ける
    if let Some(body) = req.body {
        b = b.body(body);
    }
    let idle = Duration::from_millis(req.idle_timeout_ms.unwrap_or(10_000)).min(IDLE_MAX);
    let mut res = b.send().await.map_err(|_| "network".to_string())?;
    let status = res.status().as_u16();
    if res.content_length().is_some_and(|n| n > req.max_bytes as u64) {
        return Err("too_large".into());
    }
    let mut body = Vec::new();
    // 1 つの塊が idle のあいだ届かなければ打ち切る(全体の時間は timeout が見る)
    while let Some(chunk) = tokio::time::timeout(idle, res.chunk()).await.map_err(|_| "network".to_string())?.map_err(|_| "network".to_string())? {
        if body.len() + chunk.len() > req.max_bytes {
            return Err("too_large".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(SyncHttpResponse { status, body: String::from_utf8_lossy(&body).into_owned() })
}

#[tauri::command]
pub async fn sync_http(window: tauri::Window, req: SyncHttpRequest) -> Result<SyncHttpResponse, String> {
    only_main(&window)?;
    send(req, cfg!(debug_assertions)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;

    /// 決まった応答を順に返す小さなサーバー。受け取った要求の文字列を送り返す
    fn serve(replies: Vec<Vec<u8>>) -> (String, mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            for reply in replies {
                let Ok((mut s, _)) = listener.accept() else { return };
                let mut buf = [0u8; 8192];
                let mut got = Vec::new();
                loop {
                    let n = s.read(&mut buf).unwrap_or(0);
                    got.extend_from_slice(&buf[..n]);
                    let text = String::from_utf8_lossy(&got).to_string();
                    if let Some(end) = text.find("\r\n\r\n") {
                        let len = text.to_lowercase().split("content-length:").nth(1).and_then(|v| v.split("\r\n").next()?.trim().parse::<usize>().ok()).unwrap_or(0);
                        if got.len() >= end + 4 + len {
                            break;
                        }
                    }
                    if n == 0 {
                        break;
                    }
                }
                let _ = tx.send(String::from_utf8_lossy(&got).to_string());
                let _ = s.write_all(&reply);
                let _ = s.flush();
            }
        });
        (base, rx)
    }

    fn ok(body: &str, extra: &str) -> Vec<u8> {
        format!("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: application/json\r\n{extra}Content-Length: {}\r\n\r\n{body}", body.len()).into_bytes()
    }

    fn get(url: String, max_bytes: usize) -> SyncHttpRequest {
        SyncHttpRequest { method: "GET".into(), url, headers: BTreeMap::new(), body: None, max_bytes, timeout_ms: 10_000, idle_timeout_ms: None }
    }

    #[test]
    fn https_のほかは送らない() {
        let u = |s: &str| s.parse::<Url>().unwrap();
        assert!(url_allowed(&u("https://sync.example.test/a"), false));
        assert!(!url_allowed(&u("http://sync.example.test/a"), false));
        assert!(!url_allowed(&u("http://localhost:8787/a"), false));
        assert!(!url_allowed(&u("ftp://sync.example.test/a"), true));
        assert!(url_allowed(&u("http://localhost:8787/a"), true));
        assert!(url_allowed(&u("http://127.0.0.1:8787/a"), true));
        assert!(!url_allowed(&u("http://sync.example.test/a"), true));
        let r = tauri::async_runtime::block_on(send(get("http://sync.example.test/".into(), 100), false));
        assert_eq!(r.unwrap_err(), "bad_url");
    }

    #[test]
    fn post_に_content_length_と_content_type_が付く() {
        let (base, rx) = serve(vec![ok("{}", "")]);
        let body = "{\"a\":\"日本語\"}".to_string();
        let mut headers = BTreeMap::new();
        headers.insert("Authorization".to_string(), "Bearer abc".to_string());
        headers.insert("Content-Type".to_string(), "application/json".to_string());
        let req = SyncHttpRequest { method: "POST".into(), url: format!("{base}/records"), headers, body: Some(body.clone()), max_bytes: 1000, timeout_ms: 10_000, idle_timeout_ms: None };
        let r = tauri::async_runtime::block_on(send(req, true)).unwrap();
        assert_eq!(r.status, 200);
        let got = rx.recv().unwrap().to_lowercase();
        assert!(got.starts_with("post /records"), "{got}");
        assert!(got.contains(&format!("content-length: {}\r\n", body.len())), "{got}");
        assert!(got.contains("content-type: application/json\r\n"), "{got}");
        assert!(got.contains("authorization: bearer abc\r\n"), "{got}");
    }

    #[test]
    fn リダイレクトをたどらず別の先へトークンを渡さない() {
        let (other, other_rx) = serve(vec![ok("{}", "")]);
        let (base, rx) = serve(vec![format!("HTTP/1.1 302 Found\r\nConnection: close\r\nLocation: {other}/stolen\r\nContent-Length: 0\r\n\r\n").into_bytes()]);
        let mut req = get(format!("{base}/head"), 1000);
        req.headers.insert("Authorization".into(), "Bearer abc".into());
        let r = tauri::async_runtime::block_on(send(req, true)).unwrap();
        assert_eq!(r.status, 302);
        rx.recv().unwrap();
        assert!(other_rx.recv_timeout(Duration::from_millis(300)).is_err());
    }

    #[test]
    fn 指定の時間で打ち切る() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let hold = std::thread::spawn(move || {
            let c = listener.accept();
            std::thread::sleep(Duration::from_secs(2));
            drop(c);
        });
        let mut req = get(format!("{base}/head"), 1000);
        req.timeout_ms = 200;
        let started = std::time::Instant::now();
        let r = tauri::async_runtime::block_on(send(req, true));
        assert_eq!(r.unwrap_err(), "network");
        assert!(started.elapsed() < Duration::from_millis(1500));
        hold.join().unwrap();
    }

    #[test]
    fn 長さの申告がなくても上限で読むのをやめる() {
        let big = "x".repeat(5000);
        let (base, _rx) = serve(vec![format!("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n{big}").into_bytes()]);
        let r = tauri::async_runtime::block_on(send(get(format!("{base}/changes"), 1000), true));
        assert_eq!(r.unwrap_err(), "too_large");
        let (base2, _rx2) = serve(vec![ok(&big, "")]);
        let r2 = tauri::async_runtime::block_on(send(get(format!("{base2}/changes"), 1000), true));
        assert_eq!(r2.unwrap_err(), "too_large");
    }

    #[test]
    fn cookie_を持たない() {
        let (base, rx) = serve(vec![ok("{}", "Set-Cookie: a=1; Path=/\r\n"), ok("{}", "")]);
        for _ in 0..2 {
            tauri::async_runtime::block_on(send(get(format!("{base}/head"), 1000), true)).unwrap();
        }
        rx.recv().unwrap();
        assert!(!rx.recv().unwrap().to_lowercase().contains("cookie:"));
    }
}

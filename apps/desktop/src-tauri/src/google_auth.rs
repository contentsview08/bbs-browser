//! Google でログインし、同期の置き場(Drive の appDataFolder)のアクセストークンを作る(docs/sync-drive.md 5.2・5.4・5.7)。
//! インストールしたアプリの手順(ループバック + PKCE + state)。ログインは既定のブラウザで行う(Google は埋め込みの WebView を断る)。
//! 更新用のトークンは OS の鍵保管に置き、アクセストークンはメモリだけに持つ。どちらも画面へ返さず、ログにも失敗の文にも入れない。
//! Rust から送る先は oauth2.googleapis.com(トークン)と www.googleapis.com(Drive)だけ。リダイレクトはたどらない(sync_http の client)

use std::net::Ipv4Addr;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use base64::Engine;
use sha2::{Digest, Sha256};
use tauri::{Manager, Url};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

use crate::sync_http::only_main;

/// 画面の Drive の置き場が付ける目印。sync_http が本物のアクセストークンに差し替える
pub(crate) const TOKEN_SLOT: &str = "Bearer obb-google-access-token";
const SCOPE: &str = "https://www.googleapis.com/auth/drive.appdata";
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_HOST: &str = "oauth2.googleapis.com";
const API_HOST: &str = "www.googleapis.com";
/// ブラウザでのログインを待つ長さ
const LOGIN_WAIT: Duration = Duration::from_secs(5 * 60);
/// 期限の少し前に取り直す(送っている間に切れないように)
const EARLY: Duration = Duration::from_secs(5 * 60);
const BODY_MAX: usize = 64 * 1024;
const TIMEOUT: Duration = Duration::from_secs(30);

const AUTH_FAILED: &str = "google_auth_failed";
const LOGIN_FAILED: &str = "google_login_failed";
/** 端末を足すコードで受け取ったトークンが使えない */
const PAIRING_FAILED: &str = "google_pairing_failed";
/** Google の更新用のトークンは 100 文字ほど。コード(obb2)の決まりと同じ上限 */
const REFRESH_TOKEN_MAX: usize = 512;

/// ビルドのときに入れたクライアント(build.rs)。公式にもデスクトップのシークレットは秘密にできない値で、守りは PKCE とループバックが受け持つ
struct Client {
    id: &'static str,
    secret: &'static str,
}

fn client() -> Option<Client> {
    match (option_env!("OBB_GOOGLE_CLIENT_ID"), option_env!("OBB_GOOGLE_CLIENT_SECRET")) {
        (Some(id), Some(secret)) if !id.is_empty() && !secret.is_empty() => Some(Client { id, secret }),
        _ => None,
    }
}

struct Endpoints {
    token: String,
    revoke: String,
    about: String,
}

impl Endpoints {
    fn google() -> Self {
        Self {
            token: format!("https://{OAUTH_HOST}/token"),
            revoke: format!("https://{OAUTH_HOST}/revoke"),
            about: format!("https://{API_HOST}/drive/v3/about?fields=user(permissionId%2CemailAddress)"),
        }
    }
}

/// Drive の API の先か。アクセストークンはここにだけ付ける
pub(crate) fn is_api_url(url: &Url) -> bool {
    url.scheme() == "https" && url.host_str() == Some(API_HOST) && url.port().is_none()
}

/// Rust から Google へ送ってよい先。テストだけ手元の偽の先を許す
fn allowed(url: &Url) -> bool {
    if cfg!(test) && url.scheme() == "http" && url.host_str() == Some("127.0.0.1") {
        return true;
    }
    url.scheme() == "https" && matches!(url.host_str(), Some(OAUTH_HOST) | Some(API_HOST)) && url.port().is_none()
}

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn random(n: usize) -> Result<String, String> {
    let mut buf = vec![0u8; n];
    getrandom::fill(&mut buf).map_err(|_| LOGIN_FAILED.to_string())?;
    Ok(b64(&buf))
}

fn challenge(verifier: &str) -> String {
    b64(&Sha256::digest(verifier.as_bytes()))
}

fn auth_url(client_id: &str, redirect: &str, verifier: &str, state: &str) -> String {
    let ch = challenge(verifier);
    let params = [
        ("client_id", client_id),
        ("redirect_uri", redirect),
        ("response_type", "code"),
        ("scope", SCOPE),
        ("code_challenge", ch.as_str()),
        ("code_challenge_method", "S256"),
        ("state", state),
    ];
    Url::parse_with_params(AUTH_URL, params).map(String::from).unwrap_or_default()
}

// ── 通信 ──

struct Reply {
    status: u16,
    body: serde_json::Value,
}

async fn call(b: reqwest::RequestBuilder) -> Result<Reply, String> {
    let mut res = b.timeout(TIMEOUT).send().await.map_err(|_| "network".to_string())?;
    let status = res.status().as_u16();
    let mut body = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|_| "network".to_string())? {
        if body.len() + chunk.len() > BODY_MAX {
            return Err("network".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(Reply { status, body: serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null) })
}

fn checked(url: &str) -> Result<Url, String> {
    let u: Url = url.parse().map_err(|_| "bad_url".to_string())?;
    if allowed(&u) {
        Ok(u)
    } else {
        Err("bad_url".into())
    }
}

async fn post_form(url: &str, form: &[(&str, &str)]) -> Result<Reply, String> {
    let u = checked(url)?;
    call(crate::sync_http::client()?.post(u).form(form)).await
}

#[derive(Debug, PartialEq)]
struct Tokens {
    access_token: String,
    expires_in: u64,
    refresh_token: Option<String>,
}

fn str_of(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).filter(|x| !x.is_empty()).map(String::from)
}

fn tokens_of(r: &Reply) -> Option<Tokens> {
    if r.status != 200 {
        return None;
    }
    Some(Tokens { access_token: str_of(&r.body, "access_token")?, expires_in: r.body.get("expires_in").and_then(|x| x.as_u64()).unwrap_or(3600), refresh_token: str_of(&r.body, "refresh_token") })
}

async fn exchange(ep: &Endpoints, c: &Client, code: &str, verifier: &str, redirect: &str) -> Result<Tokens, String> {
    let r = post_form(&ep.token, &[("code", code), ("code_verifier", verifier), ("client_id", c.id), ("client_secret", c.secret), ("redirect_uri", redirect), ("grant_type", "authorization_code")]).await?;
    tokens_of(&r).ok_or_else(|| LOGIN_FAILED.to_string())
}

/// 更新用のトークンが使えない(期限切れ・取り消し・100 本を超えた)ときは google_auth_failed。ログインし直すしかない。
/// 429 と 5xx だけを待てば通るもの(server)にする。ほかの 4xx(invalid_request・invalid_scope など)は送り直しても同じ答えなので、
/// 叩き続けずに止める側(google_auth_failed)へ寄せる
async fn refresh(ep: &Endpoints, c: &Client, refresh_token: &str) -> Result<Tokens, String> {
    let r = post_form(&ep.token, &[("refresh_token", refresh_token), ("client_id", c.id), ("client_secret", c.secret), ("grant_type", "refresh_token")]).await?;
    if let Some(t) = tokens_of(&r) {
        return Ok(t);
    }
    if (400..500).contains(&r.status) && r.status != 429 {
        return Err(AUTH_FAILED.into());
    }
    Err("server".into())
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq)]
pub struct GoogleAccount {
    /// Drive の permissionId。別のアカウントでのログインし直しに気づくため
    account: String,
    email: String,
}

async fn about(ep: &Endpoints, access_token: &str) -> Result<GoogleAccount, String> {
    let u = checked(&ep.about)?;
    let r = call(crate::sync_http::client()?.get(u).bearer_auth(access_token)).await?;
    let user = r.body.get("user").filter(|_| r.status == 200).ok_or_else(|| LOGIN_FAILED.to_string())?;
    Ok(GoogleAccount { account: str_of(user, "permissionId").ok_or_else(|| LOGIN_FAILED.to_string())?, email: str_of(user, "emailAddress").unwrap_or_default() })
}

/** コードで受け取ったトークンの形。印字できる ASCII だけ(packages/sync の pairing.ts と同じ) */
fn refresh_token_ok(t: &str) -> bool {
    !t.is_empty() && t.len() <= REFRESH_TOKEN_MAX && t.bytes().all(|b| (0x21..=0x7e).contains(&b))
}

/** コードで受け取ったトークンで 1 回取り直し、どのアカウントかを確かめる。使えないトークンは google_pairing_failed */
async fn check_adopted(ep: &Endpoints, c: &Client, refresh_token: &str, expect: Option<&str>) -> Result<(Stored, Tokens), String> {
    if !refresh_token_ok(refresh_token) {
        return Err("bad_code".into());
    }
    let t = refresh(ep, c, refresh_token).await.map_err(|e| if e == AUTH_FAILED { PAIRING_FAILED.to_string() } else { e })?;
    let account = about(ep, &t.access_token).await.map_err(|_| PAIRING_FAILED.to_string())?;
    if expect.is_some_and(|e| e != account.account) {
        return Err("google_other_account".into());
    }
    // 取り直しで入れ替わったら新しい方を残す
    let kept = t.refresh_token.clone().unwrap_or_else(|| refresh_token.to_string());
    Ok((Stored { refresh_token: kept, account: account.account, email: account.email }, t))
}

// ── ループバックの口 ──

enum Callback {
    Code(String),
    Denied,
    Other,
}

/// 戻ってきた要求の 1 行目から code を取り出す。state が違うもの・関係のない要求(favicon など)は無視して待ち続ける
fn parse_callback(head: &str, state: &str) -> Callback {
    let mut parts = head.lines().next().unwrap_or("").split(' ');
    let (Some("GET"), Some(target)) = (parts.next(), parts.next()) else { return Callback::Other };
    let Ok(u) = Url::parse(&format!("http://127.0.0.1{target}")) else { return Callback::Other };
    if u.path() != "/" {
        return Callback::Other;
    }
    let q = |k: &str| u.query_pairs().find(|(a, _)| a == k).map(|(_, v)| v.into_owned());
    if q("state").as_deref() != Some(state) {
        return Callback::Other;
    }
    match (q("code"), q("error")) {
        (Some(code), _) if !code.is_empty() => Callback::Code(code),
        (_, Some(_)) => Callback::Denied,
        _ => Callback::Other,
    }
}

async fn read_head(s: &mut TcpStream) -> Option<String> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 2048];
    while buf.len() < 16 * 1024 {
        let n = s.read(&mut chunk).await.ok()?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
    }
    Some(String::from_utf8_lossy(&buf).into_owned())
}

async fn respond(s: &mut TcpStream, status: &str, text: &str) {
    let body = format!("<!doctype html><html lang=\"ja\"><meta charset=\"utf-8\"><title>OBB</title><p style=\"font:16px sans-serif;margin:3em\">{text}</p></html>");
    let res = format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}", body.len());
    let _ = s.write_all(res.as_bytes()).await;
    let _ = s.shutdown().await;
}

/// 戻ってくるのを待つ。打ち切り・取り消し(別のログインを始めた・やめるを押した)で終わる
async fn wait_for_code(listener: TcpListener, state: &str, wait: Duration, mut cancel: oneshot::Receiver<()>) -> Result<String, String> {
    let deadline = tokio::time::Instant::now() + wait;
    loop {
        let (mut s, _) = tokio::select! {
            r = listener.accept() => r.map_err(|_| LOGIN_FAILED.to_string())?,
            _ = &mut cancel => return Err("cancelled".into()),
            _ = tokio::time::sleep_until(deadline) => return Err("google_login_timeout".into()),
        };
        let Ok(Some(head)) = tokio::time::timeout(Duration::from_secs(5), read_head(&mut s)).await else { continue };
        match parse_callback(&head, state) {
            Callback::Code(code) => {
                respond(&mut s, "200 OK", "ログインできました。OBB に戻ってください。このページは閉じてかまいません。").await;
                return Ok(code);
            }
            Callback::Denied => {
                respond(&mut s, "200 OK", "ログインをやめました。OBB に戻ってください。").await;
                return Err("google_login_denied".into());
            }
            Callback::Other => respond(&mut s, "404 Not Found", "").await,
        }
    }
}

// ── 手元の控え ──

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct Stored {
    refresh_token: String,
    account: String,
    email: String,
}

#[derive(Default)]
struct Session {
    loaded: bool,
    stored: Option<Stored>,
    access: Option<(String, Instant)>,
}

/// 取り直しを 1 つずつにする(同時に何本も更新しない)
fn session() -> &'static tokio::sync::Mutex<Session> {
    static S: OnceLock<tokio::sync::Mutex<Session>> = OnceLock::new();
    S.get_or_init(|| tokio::sync::Mutex::new(Session::default()))
}

/// 進んでいるログイン。新しいログインかやめるで、前のものを終わらせる
fn pending_login() -> &'static Mutex<Option<oneshot::Sender<()>>> {
    static P: OnceLock<Mutex<Option<oneshot::Sender<()>>>> = OnceLock::new();
    P.get_or_init(|| Mutex::new(None))
}

async fn ensure_loaded(window: &tauri::Window, s: &mut Session) -> Result<(), String> {
    if !s.loaded {
        let raw = crate::sync_key::google_load(window).await?;
        // 読めない値はログインしていないものとして扱う
        s.stored = raw.and_then(|r| serde_json::from_str(&r).ok());
        s.loaded = true;
    }
    Ok(())
}

fn expiry(t: &Tokens) -> Instant {
    Instant::now() + Duration::from_secs(t.expires_in).saturating_sub(EARLY)
}

/// 今のアクセストークン。fresh は Drive に 401 を返されたあとの取り直し
pub(crate) async fn access_token(window: &tauri::Window, fresh: bool) -> Result<String, String> {
    let c = client().ok_or_else(|| AUTH_FAILED.to_string())?;
    let mut s = session().lock().await;
    if !fresh {
        if let Some((t, until)) = &s.access {
            if Instant::now() < *until {
                return Ok(t.clone());
            }
        }
    }
    s.access = None;
    ensure_loaded(window, &mut s).await?;
    let stored = s.stored.clone().ok_or_else(|| AUTH_FAILED.to_string())?;
    let t = refresh(&Endpoints::google(), &c, &stored.refresh_token).await?;
    // 更新で入れ替わることがあれば新しい方を残す(公式に明記がないので、来たときだけ)
    if let Some(next) = t.refresh_token.as_ref().filter(|r| **r != stored.refresh_token) {
        let updated = Stored { refresh_token: next.clone(), ..stored };
        crate::sync_key::google_save(window, serde_json::to_string(&updated).map_err(|_| AUTH_FAILED.to_string())?).await?;
        s.stored = Some(updated);
    }
    s.access = Some((t.access_token.clone(), expiry(&t)));
    Ok(t.access_token)
}

// ── 命令 ──

/// このビルドに Google のクライアントが入っているか
#[tauri::command]
pub fn google_available() -> bool {
    client().is_some()
}

/// ログインしているアカウント。通信しない
#[tauri::command]
pub async fn google_account(window: tauri::Window) -> Result<Option<GoogleAccount>, String> {
    only_main(&window)?;
    let mut s = session().lock().await;
    ensure_loaded(&window, &mut s).await?;
    Ok(s.stored.as_ref().map(|x| GoogleAccount { account: x.account.clone(), email: x.email.clone() }))
}

/// 既定のブラウザでログインし、更新用のトークンを鍵保管に置く。expect と違うアカウントなら置き換えない
#[tauri::command]
pub async fn google_login(window: tauri::Window, expect: Option<String>) -> Result<GoogleAccount, String> {
    only_main(&window)?;
    let c = client().ok_or_else(|| "google_unavailable".to_string())?;
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.map_err(|_| LOGIN_FAILED.to_string())?;
    let port = listener.local_addr().map_err(|_| LOGIN_FAILED.to_string())?.port();
    let redirect = format!("http://127.0.0.1:{port}");
    let verifier = random(48)?;
    let state = random(24)?;
    let (tx, rx) = oneshot::channel();
    // 前のログインは終わらせる(ブラウザを閉じてから押し直したとき)
    *pending_login().lock().map_err(|_| LOGIN_FAILED.to_string())? = Some(tx);
    window.app_handle().opener().open_url(auth_url(c.id, &redirect, &verifier, &state), None::<&str>).map_err(|_| LOGIN_FAILED.to_string())?;
    let code = wait_for_code(listener, &state, LOGIN_WAIT, rx).await?;
    let ep = Endpoints::google();
    let t = exchange(&ep, &c, &code, &verifier, &redirect).await?;
    let refresh_token = t.refresh_token.clone().ok_or_else(|| LOGIN_FAILED.to_string())?;
    let account = about(&ep, &t.access_token).await?;
    if expect.as_ref().is_some_and(|e| *e != account.account) {
        return Err("google_other_account".into());
    }
    let stored = Stored { refresh_token, account: account.account.clone(), email: account.email.clone() };
    let mut s = session().lock().await;
    crate::sync_key::google_save(&window, serde_json::to_string(&stored).map_err(|_| LOGIN_FAILED.to_string())?).await?;
    *s = Session { loaded: true, stored: Some(stored), access: Some((t.access_token.clone(), expiry(&t))) };
    Ok(account)
}

/// アクセストークンを用意する(本物は返さない)。fresh は Drive に 401 を返されたあとの取り直し
#[tauri::command]
pub async fn google_access_token(window: tauri::Window, fresh: bool) -> Result<(), String> {
    only_main(&window)?;
    access_token(&window, fresh).await.map(|_| ())
}

/// 端末を足すコード(obb2)に入れる更新用のトークン。画面へ出すのはこの命令だけで、コードを出している間だけ画面が持つ
#[tauri::command]
pub async fn google_pairing_token(window: tauri::Window) -> Result<String, String> {
    only_main(&window)?;
    let mut s = session().lock().await;
    ensure_loaded(&window, &mut s).await?;
    s.stored.as_ref().map(|x| x.refresh_token.clone()).ok_or_else(|| AUTH_FAILED.to_string())
}

/// コードで受け取った更新用のトークンを Google に確かめてから鍵保管に置く。この端末は Google のログインをしない。
/// expect と違うアカウントなら置き換えない
#[tauri::command]
pub async fn google_adopt(window: tauri::Window, refresh_token: String, expect: Option<String>) -> Result<GoogleAccount, String> {
    only_main(&window)?;
    let c = client().ok_or_else(|| "google_unavailable".to_string())?;
    let (stored, t) = check_adopted(&Endpoints::google(), &c, &refresh_token, expect.as_deref()).await?;
    let account = GoogleAccount { account: stored.account.clone(), email: stored.email.clone() };
    let mut s = session().lock().await;
    crate::sync_key::google_save(&window, serde_json::to_string(&stored).map_err(|_| PAIRING_FAILED.to_string())?).await?;
    *s = Session { loaded: true, stored: Some(stored), access: Some((t.access_token.clone(), expiry(&t))) };
    Ok(account)
}

/// 進んでいるログインをやめる
#[tauri::command]
pub fn google_login_cancel(window: tauri::Window) -> Result<(), String> {
    only_main(&window)?;
    if let Some(tx) = pending_login().lock().map_err(|_| LOGIN_FAILED.to_string())?.take() {
        let _ = tx.send(());
    }
    Ok(())
}

/// 手元のトークンを消す。Google へ取り消しは送らない(同じ許可を使う他の端末を止めないため)
#[tauri::command]
pub async fn google_forget(window: tauri::Window) -> Result<(), String> {
    only_main(&window)?;
    let mut s = session().lock().await;
    crate::sync_key::google_clear(&window).await?;
    *s = Session { loaded: true, ..Session::default() };
    Ok(())
}

/// Google へ取り消しを送ってから手元も消す。全端末が止まる。送れなかったら手元は残す(もう一度押せるように)
#[tauri::command]
pub async fn google_revoke(window: tauri::Window) -> Result<(), String> {
    only_main(&window)?;
    let mut s = session().lock().await;
    ensure_loaded(&window, &mut s).await?;
    if let Some(stored) = &s.stored {
        let r = post_form(&Endpoints::google().revoke, &[("token", stored.refresh_token.as_str())]).await?;
        // 400 はもう使えないトークン(取り消し済み・期限切れ)。消すだけでよい
        if r.status != 200 && r.status != 400 {
            return Err("server".into());
        }
    }
    crate::sync_key::google_clear(&window).await?;
    *s = Session { loaded: true, ..Session::default() };
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync_http::tests::{ok, serve};

    const C: Client = Client { id: "cid.apps.googleusercontent.com", secret: "csecret" };

    fn ep(base: &str) -> Endpoints {
        Endpoints { token: format!("{base}/token"), revoke: format!("{base}/revoke"), about: format!("{base}/about") }
    }

    fn fail(status: &str, body: &str) -> Vec<u8> {
        format!("HTTP/1.1 {status}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len()).into_bytes()
    }

    #[test]
    fn pkce_は_s256() {
        // RFC 7636 の付録 B の例
        assert_eq!(challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        let v = random(48).unwrap();
        assert_eq!(v.len(), 64);
        assert!(v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'));
        assert_ne!(v, random(48).unwrap());
    }

    /// 手元のクライアントを入れてビルドしたときだけ回す(OBB_GOOGLE_OAUTH_FILE などを付けて --ignored)
    #[test]
    #[ignore]
    fn ビルドにクライアントが入っている() {
        let c = client().expect("クライアントが入っていない");
        assert!(c.id.ends_with(".apps.googleusercontent.com"));
        assert!(!c.secret.is_empty() && !c.secret.contains(char::is_whitespace));
    }

    #[test]
    fn 同意の画面の_url() {
        let u: Url = auth_url(C.id, "http://127.0.0.1:5000", "verifier", "st").parse().unwrap();
        assert_eq!(u.host_str(), Some("accounts.google.com"));
        let q: std::collections::HashMap<String, String> = u.query_pairs().into_owned().collect();
        assert_eq!(q["scope"], "https://www.googleapis.com/auth/drive.appdata");
        assert_eq!(q["redirect_uri"], "http://127.0.0.1:5000");
        assert_eq!(q["code_challenge"], challenge("verifier"));
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["state"], "st");
        assert_eq!(q["response_type"], "code");
        // シークレットは URL に載せない
        assert!(!q.values().any(|v| v.contains("csecret")));
    }

    #[test]
    fn 送ってよい先は_google_のトークンと_drive_だけ() {
        let u = |s: &str| s.parse::<Url>().unwrap();
        assert!(is_api_url(&u("https://www.googleapis.com/drive/v3/files")));
        assert!(is_api_url(&u("https://www.googleapis.com/upload/drive/v3/files")));
        assert!(!is_api_url(&u("https://oauth2.googleapis.com/token")));
        assert!(!is_api_url(&u("http://www.googleapis.com/drive/v3/files")));
        assert!(!is_api_url(&u("https://www.googleapis.com:8443/drive/v3/files")));
        assert!(!is_api_url(&u("https://www.googleapis.com.example.test/drive")));
        assert!(!is_api_url(&u("https://sync.example.test/head")));
        assert!(allowed(&u("https://oauth2.googleapis.com/token")));
        assert!(!allowed(&u("https://accounts.google.com/o/oauth2/v2/auth")));
        assert!(!allowed(&u("https://evil.example.test/token")));
    }

    #[test]
    fn 戻ってきた要求から_code_を取り出す() {
        let get = |t: &str| format!("GET {t} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
        assert!(matches!(parse_callback(&get("/?state=st&code=4%2Fabc&scope=x"), "st"), Callback::Code(c) if c == "4/abc"));
        assert!(matches!(parse_callback(&get("/?state=other&code=abc"), "st"), Callback::Other));
        assert!(matches!(parse_callback(&get("/?code=abc"), "st"), Callback::Other));
        assert!(matches!(parse_callback(&get("/favicon.ico"), "st"), Callback::Other));
        assert!(matches!(parse_callback(&get("/x?state=st&code=abc"), "st"), Callback::Other));
        assert!(matches!(parse_callback(&get("/?state=st&error=access_denied"), "st"), Callback::Denied));
        assert!(matches!(parse_callback("POST /?state=st&code=abc HTTP/1.1\r\n\r\n", "st"), Callback::Other));
    }

    async fn hit(port: u16, target: &str) -> String {
        let mut s = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).await.unwrap();
        s.write_all(format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").as_bytes()).await.unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).await.unwrap();
        out
    }

    #[test]
    fn ループバックの口は_state_の合う_1_回で閉じる() {
        tauri::async_runtime::block_on(async {
            let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
            let port = listener.local_addr().unwrap().port();
            let (_tx, rx) = oneshot::channel();
            let waiting = tauri::async_runtime::spawn(async move { wait_for_code(listener, "st", Duration::from_secs(10), rx).await });
            assert!(hit(port, "/favicon.ico").await.starts_with("HTTP/1.1 404"));
            assert!(hit(port, "/?state=bad&code=x").await.starts_with("HTTP/1.1 404"));
            let page = hit(port, "/?state=st&code=good").await;
            assert!(page.starts_with("HTTP/1.1 200") && page.contains("OBB に戻ってください"));
            assert_eq!(waiting.await.unwrap().unwrap(), "good");
            // 閉じたので、もう受けない
            assert!(TcpStream::connect((Ipv4Addr::LOCALHOST, port)).await.is_err());
        });
    }

    #[test]
    fn ログインの待ちは_やめる_拒否_打ち切りで終わる() {
        tauri::async_runtime::block_on(async {
            let l = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
            let (tx, rx) = oneshot::channel();
            let w = tauri::async_runtime::spawn(async move { wait_for_code(l, "st", Duration::from_secs(10), rx).await });
            tx.send(()).unwrap();
            assert_eq!(w.await.unwrap().unwrap_err(), "cancelled");

            // 新しいログインで前の送り口が捨てられたときも終わる
            let l = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
            let (tx, rx) = oneshot::channel::<()>();
            drop(tx);
            assert_eq!(wait_for_code(l, "st", Duration::from_secs(10), rx).await.unwrap_err(), "cancelled");

            let l = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
            let port = l.local_addr().unwrap().port();
            let (_tx, rx) = oneshot::channel();
            let w = tauri::async_runtime::spawn(async move { wait_for_code(l, "st", Duration::from_secs(10), rx).await });
            hit(port, "/?state=st&error=access_denied").await;
            assert_eq!(w.await.unwrap().unwrap_err(), "google_login_denied");

            let l = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
            let (_tx, rx) = oneshot::channel();
            assert_eq!(wait_for_code(l, "st", Duration::from_millis(100), rx).await.unwrap_err(), "google_login_timeout");
        });
    }

    #[test]
    fn code_を交換し_アカウントを確かめる() {
        let (base, rx) = serve(vec![
            ok(r#"{"access_token":"at1","expires_in":3599,"refresh_token":"rt1","scope":"https://www.googleapis.com/auth/drive.appdata","token_type":"Bearer"}"#, ""),
            ok(r#"{"user":{"permissionId":"0123","emailAddress":"a@example.test"}}"#, ""),
        ]);
        let e = ep(&base);
        let t = tauri::async_runtime::block_on(exchange(&e, &C, "4/code", "ver", "http://127.0.0.1:5000")).unwrap();
        assert_eq!(t, Tokens { access_token: "at1".into(), expires_in: 3599, refresh_token: Some("rt1".into()) });
        let sent = rx.recv().unwrap();
        assert!(sent.starts_with("POST /token"), "{sent}");
        for part in ["grant_type=authorization_code", "code=4%2Fcode", "code_verifier=ver", "client_secret=csecret", "redirect_uri=http%3A%2F%2F127.0.0.1%3A5000"] {
            assert!(sent.contains(part), "{part}");
        }
        let a = tauri::async_runtime::block_on(about(&e, "at1")).unwrap();
        assert_eq!(a, GoogleAccount { account: "0123".into(), email: "a@example.test".into() });
        assert!(rx.recv().unwrap().to_lowercase().contains("authorization: bearer at1"));
    }

    #[test]
    fn 取り直しの失敗を分ける() {
        let (base, rx) = serve(vec![
            ok(r#"{"access_token":"at2","expires_in":3599,"token_type":"Bearer"}"#, ""),
            fail("400 Bad Request", r#"{"error":"invalid_grant","error_description":"Token has been expired or revoked."}"#),
            fail("503 Service Unavailable", "{}"),
            ok(r#"{"access_token":"at3","expires_in":3599,"refresh_token":"rt-new"}"#, ""),
            fail("400 Bad Request", r#"{"error":"invalid_request"}"#),
            fail("429 Too Many Requests", "{}"),
        ]);
        let e = ep(&base);
        let r = |rt: &'static str| tauri::async_runtime::block_on(refresh(&e, &C, rt));
        assert_eq!(r("rt1").unwrap(), Tokens { access_token: "at2".into(), expires_in: 3599, refresh_token: None });
        assert!(rx.recv().unwrap().contains("grant_type=refresh_token"));
        assert_eq!(r("rt1").unwrap_err(), "google_auth_failed");
        assert_eq!(r("rt1").unwrap_err(), "server");
        assert_eq!(r("rt1").unwrap().refresh_token.as_deref(), Some("rt-new"));
        // invalid_grant 以外の 400 も、送り直して通るものではないので止める。429 は待つ
        assert_eq!(r("rt1").unwrap_err(), "google_auth_failed");
        assert_eq!(r("rt1").unwrap_err(), "server");
    }

    #[test]
    fn コードのトークンを確かめてから受け取る() {
        let (base, rx) = serve(vec![
            ok(r#"{"access_token":"at5","expires_in":3599,"token_type":"Bearer"}"#, ""),
            ok(r#"{"user":{"permissionId":"0123","emailAddress":"a@example.test"}}"#, ""),
            fail("400 Bad Request", r#"{"error":"invalid_grant"}"#),
            ok(r#"{"access_token":"at6","expires_in":3599}"#, ""),
            ok(r#"{"user":{"permissionId":"9999","emailAddress":"b@example.test"}}"#, ""),
            ok(r#"{"access_token":"at7","expires_in":3599,"refresh_token":"rt-next"}"#, ""),
            ok(r#"{"user":{"permissionId":"0123","emailAddress":"a@example.test"}}"#, ""),
        ]);
        let e = ep(&base);
        // Stored は Debug を持たない(トークンを表示に出さない)ので、失敗は err() で取り出す
        let run = |rt: &'static str, expect: Option<&'static str>| tauri::async_runtime::block_on(check_adopted(&e, &C, rt, expect));
        let (stored, t) = run("1//rt-shared", None).unwrap();
        assert_eq!((stored.refresh_token.as_str(), stored.account.as_str(), stored.email.as_str()), ("1//rt-shared", "0123", "a@example.test"));
        assert_eq!(t.access_token, "at5");
        assert!(rx.recv().unwrap().contains("grant_type=refresh_token"));
        assert!(rx.recv().unwrap().to_lowercase().contains("authorization: bearer at5"));
        // 使えないトークン・違うアカウント
        assert_eq!(run("rt-dead", None).err().unwrap(), "google_pairing_failed");
        assert_eq!(run("rt-other", Some("0123")).err().unwrap(), "google_other_account");
        // 取り直しで入れ替わったら新しい方を置く
        assert_eq!(run("rt-old", Some("0123")).unwrap().0.refresh_token, "rt-next");
        // 形の違うものは送らない
        for bad in ["", "a b", "トークン", &"x".repeat(REFRESH_TOKEN_MAX + 1)] {
            assert_eq!(tauri::async_runtime::block_on(check_adopted(&e, &C, bad, None)).err().unwrap(), "bad_code");
        }
    }

    #[test]
    fn 失敗の文にトークンを入れない() {
        let (base, _rx) = serve(vec![fail("401 Unauthorized", r#"{"error":"invalid_client","error_description":"secret rt-secret"}"#), fail("401 Unauthorized", "{}")]);
        let e = ep(&base);
        let err = tauri::async_runtime::block_on(refresh(&e, &C, "rt-secret")).unwrap_err();
        assert_eq!(err, "google_auth_failed");
        let err = tauri::async_runtime::block_on(about(&e, "at-secret")).unwrap_err();
        assert_eq!(err, "google_login_failed");
        // 許していない先へは送らない
        let bad = Endpoints { token: "https://evil.example.test/token".into(), revoke: String::new(), about: String::new() };
        assert_eq!(tauri::async_runtime::block_on(refresh(&bad, &C, "rt")).unwrap_err(), "bad_url");
    }
}

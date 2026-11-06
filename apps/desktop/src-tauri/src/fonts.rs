//! 書体の取得と置き場。画面からは書体のキーだけを受け取り、取得元の URL と置き場のパスはここで決める。
//!
//! 取得元は jsDelivr の fontsource だけ。置き場は データフォルダ/fonts/<キー>/ で、
//! 字のファイルは連番の名前(0.woff2 …)、CSS は font.css。一時フォルダに全部そろってから名前を変えるので、
//! fonts/<キー>/ があれば、中身はそろっている。

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};

const CDN: &str = "https://cdn.jsdelivr.net/npm/";
const FONTS_DIR: &str = "fonts";
const FONT_CSS: &str = "font.css";
const TMP_PREFIX: &str = ".tmp-";
const EVENT: &str = "font-download";
/// ブラウザが 1 つの相手へ同時に開く数と同じ
const WORKERS: usize = 6;
/// 取得元の異常でディスクを埋めないための上限
const MAX_CSS_BYTES: u64 = 2 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 30 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 300 * 1024 * 1024;
const WOFF2_MAGIC: &[u8] = b"wOF2";

/// 書体のキー(ui/settings.ts の FONT_FAMILIES)→ 取得元の CSS
const SOURCES: &[(&str, &[&str])] = &[
    ("noto", &["@fontsource-variable/noto-sans-jp@5/index.css"]),
    ("biz-ud", &["@fontsource/biz-udpgothic@5/400.css", "@fontsource/biz-udpgothic@5/700.css"]),
    ("m-plus-1p", &["@fontsource/m-plus-1p@5/400.css", "@fontsource/m-plus-1p@5/700.css"]),
    ("m-plus-2", &["@fontsource-variable/m-plus-2@5/index.css"]),
    ("zen-kaku", &["@fontsource/zen-kaku-gothic-new@5/400.css", "@fontsource/zen-kaku-gothic-new@5/700.css"]),
    ("ibm-plex", &["@fontsource/ibm-plex-sans-jp@5/400.css", "@fontsource/ibm-plex-sans-jp@5/700.css"]),
    ("murecho", &["@fontsource-variable/murecho@5/index.css"]),
    ("sawarabi", &["@fontsource/sawarabi-gothic@5/400.css"]),
    ("m-plus-rounded", &["@fontsource/m-plus-rounded-1c@5/400.css", "@fontsource/m-plus-rounded-1c@5/700.css"]),
    ("zen-maru", &["@fontsource/zen-maru-gothic@5/400.css", "@fontsource/zen-maru-gothic@5/700.css"]),
    ("kosugi-maru", &["@fontsource/kosugi-maru@5/400.css"]),
    ("noto-serif", &["@fontsource-variable/noto-serif-jp@5/index.css"]),
    ("biz-ud-mincho", &["@fontsource/biz-udpmincho@5/400.css", "@fontsource/biz-udpmincho@5/700.css"]),
    ("shippori-mincho", &["@fontsource/shippori-mincho@5/400.css", "@fontsource/shippori-mincho@5/700.css"]),
    ("zen-old-mincho", &["@fontsource/zen-old-mincho@5/400.css", "@fontsource/zen-old-mincho@5/700.css"]),
];

fn sources_of(key: &str) -> Result<&'static [&'static str], String> {
    SOURCES.iter().find(|(k, _)| *k == key).map(|(_, s)| *s).ok_or_else(|| "知らない書体です".to_string())
}

// ── CSS の読み替え ──

/// 取得元の CSS を読み替えた結果
#[derive(Debug, PartialEq)]
struct ParsedCss {
    /// @font-face だけを残し、字のファイルを url("連番.woff2") に置き換えた CSS
    css: String,
    /// 取得するファイルの名前(files/ の下。並びは連番と同じ)
    files: Vec<String>,
}

fn is_safe_file_name(name: &str) -> bool {
    !name.starts_with('.') && name.ends_with(".woff2") && name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

/// src の値から woff2 の url(./files/…) と format を取り出す。WebView はみな woff2 を読めるので woff は捨てる
fn woff2_of_src(src: &str) -> Option<(String, String)> {
    src.split(',').find_map(|part| {
        let name = part.split("url(./files/").nth(1)?.split(')').next()?;
        let format = part.split("format(").nth(1)?.split(')').next()?;
        is_safe_file_name(name).then(|| (name.to_string(), format.trim().to_string()))
    })
}

/// fontsource の CSS を読み替える。first は連番の始まり(CSS が 2 つある書体で続きから振る)。
/// 想定と違う形なら Err(取得元が変わったときに、読めない CSS を置かないため)
fn parse_font_css(source: &str, first: usize) -> Result<ParsedCss, String> {
    const BAD: &str = "書体の CSS を読めませんでした";
    let mut out = ParsedCss { css: String::new(), files: Vec::new() };
    for block in source.split("@font-face").skip(1) {
        let body = block.split_once('{').and_then(|(_, rest)| rest.split_once('}')).ok_or(BAD)?.0;
        let mut decls: Vec<String> = Vec::new();
        for decl in body.split(';').map(str::trim).filter(|d| !d.is_empty()) {
            if let Some(src) = decl.strip_prefix("src:") {
                let (name, format) = woff2_of_src(src).ok_or(BAD)?;
                decls.push(format!("src:url(\"{}.woff2\") format({format})", first + out.files.len()));
                out.files.push(name);
            } else if decl.contains("url(") {
                return Err(BAD.to_string());
            } else {
                decls.push(decl.to_string());
            }
        }
        out.css.push_str(&format!("@font-face{{{}}}\n", decls.join(";")));
    }
    if out.files.is_empty() {
        return Err(BAD.to_string());
    }
    Ok(out)
}

// ── 取得 ──

#[derive(Debug, PartialEq)]
enum DownloadError {
    Canceled,
    Failed(String),
}

impl From<String> for DownloadError {
    fn from(s: String) -> Self {
        Self::Failed(s)
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("OBB")
        .connect_timeout(std::time::Duration::from_secs(15))
        .read_timeout(std::time::Duration::from_secs(30))
        // 取得元を決めた所だけにする
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())
}

/// 上限つきで全部読む。Err の bool は、もう一度試す意味があるか(通信の失敗)
async fn fetch(client: &reqwest::Client, url: &str, limit: u64) -> Result<Vec<u8>, (String, bool)> {
    let offline = |_: reqwest::Error| ("取得元につながりませんでした。ネットワークを確かめてください".to_string(), true);
    let mut res = client.get(url).send().await.map_err(offline)?;
    if !res.status().is_success() {
        return Err((format!("取得元がエラーを返しました(HTTP {})", res.status().as_u16()), false));
    }
    let too_big = || ("ファイルが大きすぎます".to_string(), false);
    if res.content_length().is_some_and(|n| n > limit) {
        return Err(too_big());
    }
    let mut body = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(offline)? {
        if body.len() as u64 + chunk.len() as u64 > limit {
            return Err(too_big());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

async fn fetch_retry(client: &reqwest::Client, url: &str, limit: u64) -> Result<Vec<u8>, String> {
    match fetch(client, url, limit).await {
        Err((_, true)) => fetch(client, url, limit).await.map_err(|(e, _)| e),
        other => other.map_err(|(e, _)| e),
    }
}

/// 1 書体を取りに行き、そろったら fonts_dir/<key>/ に置く。失敗・中止のときは何も残さない
async fn download_font_files(
    base: &str,
    fonts_dir: &Path,
    key: &str,
    sources: &[&str],
    cancel: Arc<AtomicBool>,
    progress: Arc<dyn Fn(usize, usize) + Send + Sync>,
) -> Result<(), DownloadError> {
    let tmp = fonts_dir.join(format!("{TMP_PREFIX}{key}"));
    let _ = std::fs::remove_dir_all(&tmp);
    let result = download_to_tmp(base, &tmp, sources, cancel, progress).await.and_then(|()| {
        let dest = fonts_dir.join(key);
        let _ = std::fs::remove_dir_all(&dest);
        std::fs::rename(&tmp, &dest).map_err(|e| DownloadError::Failed(format!("保存できませんでした: {e}")))
    });
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&tmp);
    }
    result
}

async fn download_to_tmp(
    base: &str,
    tmp: &Path,
    sources: &[&str],
    cancel: Arc<AtomicBool>,
    progress: Arc<dyn Fn(usize, usize) + Send + Sync>,
) -> Result<(), DownloadError> {
    std::fs::create_dir_all(tmp).map_err(|e| format!("保存できませんでした: {e}"))?;
    let client = client()?;
    let mut css = String::new();
    let mut queue = VecDeque::new();
    for source in sources {
        if cancel.load(Ordering::Relaxed) {
            return Err(DownloadError::Canceled);
        }
        let text = fetch_retry(&client, &format!("{base}{source}"), MAX_CSS_BYTES).await?;
        let parsed = parse_font_css(&String::from_utf8_lossy(&text), queue.len())?;
        css.push_str(&parsed.css);
        let package = source.rsplit_once('/').map_or("", |(p, _)| p);
        for name in parsed.files {
            let number = queue.len();
            queue.push_back((format!("{base}{package}/files/{name}"), tmp.join(format!("{number}.woff2"))));
        }
    }
    let total = queue.len();
    progress(0, total);

    let queue = Arc::new(Mutex::new(queue));
    let done = Arc::new(AtomicUsize::new(0));
    let bytes = Arc::new(AtomicU64::new(0));
    let failure: Arc<Mutex<Option<String>>> = Arc::default();
    let workers: Vec<_> = (0..WORKERS)
        .map(|_| {
            let (client, queue, done, bytes, failure, cancel, progress) =
                (client.clone(), queue.clone(), done.clone(), bytes.clone(), failure.clone(), cancel.clone(), progress.clone());
            tauri::async_runtime::spawn(async move {
                loop {
                    if cancel.load(Ordering::Relaxed) || failure.lock().unwrap().is_some() {
                        return;
                    }
                    let Some((url, path)) = queue.lock().unwrap().pop_front() else { return };
                    let saved = save_font_file(&client, &url, &path, &bytes).await;
                    match saved {
                        Ok(()) => progress(done.fetch_add(1, Ordering::Relaxed) + 1, total),
                        Err(e) => {
                            failure.lock().unwrap().get_or_insert(e);
                            return;
                        }
                    }
                }
            })
        })
        .collect();
    for worker in workers {
        let _ = worker.await;
    }
    if cancel.load(Ordering::Relaxed) {
        return Err(DownloadError::Canceled);
    }
    if let Some(e) = failure.lock().unwrap().take() {
        return Err(DownloadError::Failed(e));
    }
    if done.load(Ordering::Relaxed) != total {
        return Err(DownloadError::Failed("途中で止まりました".to_string()));
    }
    std::fs::write(tmp.join(FONT_CSS), css).map_err(|e| format!("保存できませんでした: {e}"))?;
    Ok(())
}

async fn save_font_file(client: &reqwest::Client, url: &str, path: &Path, total: &AtomicU64) -> Result<(), String> {
    let body = fetch_retry(client, url, MAX_FILE_BYTES).await?;
    if !body.starts_with(WOFF2_MAGIC) {
        return Err("書体のファイルではないものが返ってきました".to_string());
    }
    if total.fetch_add(body.len() as u64, Ordering::Relaxed) + body.len() as u64 > MAX_TOTAL_BYTES {
        return Err("ファイルが大きすぎます".to_string());
    }
    std::fs::write(path, body).map_err(|e| format!("保存できませんでした: {e}"))
}

// ── 画面とのやりとり ──

struct Job {
    done: usize,
    total: usize,
    switch_to: bool,
    cancel: Arc<AtomicBool>,
    /// 中止を頼んだあとで選び直された
    restart: bool,
}

#[derive(Default)]
struct JobsInner {
    running: HashMap<String, Job>,
    failed: HashMap<String, String>,
}

#[derive(Default)]
pub struct FontJobs(Mutex<JobsInner>);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FontEvent<'a> {
    key: &'a str,
    state: &'static str,
    done: usize,
    total: usize,
    switch_to: bool,
    error: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontStatus {
    ready: Vec<String>,
    running: Vec<RunningFont>,
    failed: Vec<FailedFont>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningFont {
    key: String,
    done: usize,
    total: usize,
    switch_to: bool,
}

#[derive(serde::Serialize)]
pub struct FailedFont {
    key: String,
    error: String,
}

#[derive(serde::Serialize)]
pub struct LocalFont {
    css: String,
    dir: String,
}

fn fonts_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(crate::data_dir(app)?.join(FONTS_DIR))
}

fn is_ready(fonts: &Path, key: &str) -> bool {
    fonts.join(key).join(FONT_CSS).is_file()
}

/// 起動時に呼ぶ。置き場を画面から読めるようにし、前の起動で残った一時フォルダを消す
pub fn prepare(app: &tauri::AppHandle) {
    let Ok(dir) = fonts_dir(app) else { return };
    let _ = std::fs::create_dir_all(&dir);
    // ポータブルでは置き場が %APPDATA% の外になるので、tauri.conf.json の許可ではなくここで許す
    let _ = app.asset_protocol_scope().allow_directory(&dir, true);
    for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
        if entry.file_name().to_string_lossy().starts_with(TMP_PREFIX) {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// 取得済み・取得中・失敗した書体(設定を開いたときの状態)
#[tauri::command]
pub fn font_status(app: tauri::AppHandle, jobs: tauri::State<'_, FontJobs>) -> Result<FontStatus, String> {
    let dir = fonts_dir(&app)?;
    let inner = jobs.0.lock().unwrap();
    Ok(FontStatus {
        ready: SOURCES.iter().map(|(k, _)| *k).filter(|k| is_ready(&dir, k)).map(str::to_string).collect(),
        running: inner
            .running
            .iter()
            .map(|(key, j)| RunningFont { key: key.clone(), done: j.done, total: j.total, switch_to: j.switch_to })
            .collect(),
        failed: inner.failed.iter().map(|(key, error)| FailedFont { key: key.clone(), error: error.clone() }).collect(),
    })
}

/// 取得済みの書体の CSS と置き場(なければ None)
#[tauri::command]
pub fn font_css(app: tauri::AppHandle, key: String) -> Result<Option<LocalFont>, String> {
    sources_of(&key)?;
    let dir = fonts_dir(&app)?.join(&key);
    match std::fs::read_to_string(dir.join(FONT_CSS)) {
        Ok(css) => Ok(Some(LocalFont { css, dir: dir.to_string_lossy().into_owned() })),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// 書体を取りに行く(進み具合は font-download で全部のウィンドウへ知らせる)。
/// switch_to: 終わったらこの書体に切り替える。前に選んだ取得は要らなくなるので止める
#[tauri::command]
pub fn download_font(app: tauri::AppHandle, jobs: tauri::State<'_, FontJobs>, key: String, switch_to: bool) -> Result<(), String> {
    sources_of(&key)?;
    {
        let mut inner = jobs.0.lock().unwrap();
        if switch_to {
            for (other, job) in inner.running.iter_mut() {
                // 選んである書体の取得(switch_to でないもの)は残す。新しい方が失敗したら、その書体のままなので
                if *other != key && job.switch_to {
                    job.cancel.store(true, Ordering::Relaxed);
                    job.restart = false;
                }
            }
        }
        if let Some(job) = inner.running.get_mut(&key) {
            job.switch_to |= switch_to;
            job.restart = job.cancel.load(Ordering::Relaxed);
            return Ok(());
        }
    }
    start_job(&app, key, switch_to)
}

/// 取得をやめる。途中のファイルは残さない
#[tauri::command]
pub fn cancel_font_download(jobs: tauri::State<'_, FontJobs>, key: String) {
    if let Some(job) = jobs.0.lock().unwrap().running.get_mut(&key) {
        job.cancel.store(true, Ordering::Relaxed);
        job.switch_to = false;
        job.restart = false;
    }
}

fn start_job(app: &tauri::AppHandle, key: String, switch_to: bool) -> Result<(), String> {
    let sources = sources_of(&key)?;
    let dir = fonts_dir(app)?;
    let notify = |state: &'static str, done, total, switch_to, error| {
        let _ = app.emit(EVENT, FontEvent { key: &key, state, done, total, switch_to, error });
    };
    if is_ready(&dir, &key) {
        notify("done", 0, 0, switch_to, None);
        return Ok(());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let jobs = app.state::<FontJobs>();
        let mut inner = jobs.0.lock().unwrap();
        inner.failed.remove(&key);
        inner.running.insert(key.clone(), Job { done: 0, total: 0, switch_to, cancel: cancel.clone(), restart: false });
    }
    notify("running", 0, 0, switch_to, None);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let progress: Arc<dyn Fn(usize, usize) + Send + Sync> = {
            let (app, key) = (app.clone(), key.clone());
            Arc::new(move |done, total| {
                let jobs = app.state::<FontJobs>();
                let mut inner = jobs.0.lock().unwrap();
                let Some(job) = inner.running.get_mut(&key) else { return };
                job.done = done;
                job.total = total;
                let switch_to = job.switch_to;
                drop(inner);
                let _ = app.emit(EVENT, FontEvent { key: &key, state: "running", done, total, switch_to, error: None });
            })
        };
        let result = download_font_files(CDN, &dir, &key, sources, cancel, progress).await;
        let job = app.state::<FontJobs>().0.lock().unwrap().running.remove(&key);
        let (done, total, switch_to, restart) = job.map_or((0, 0, false, false), |j| (j.done, j.total, j.switch_to, j.restart));
        let event = |state, error| FontEvent { key: &key, state, done, total, switch_to, error };
        match result {
            Ok(()) => {
                let _ = app.emit(EVENT, event("done", None));
            }
            Err(DownloadError::Canceled) if restart => {
                let _ = start_job(&app, key.clone(), switch_to);
            }
            Err(DownloadError::Canceled) => {
                let _ = app.emit(EVENT, event("canceled", None));
            }
            Err(DownloadError::Failed(e)) => {
                app.state::<FontJobs>().0.lock().unwrap().failed.insert(key.clone(), e.clone());
                let _ = app.emit(EVENT, event("failed", Some(e)));
            }
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    const FACE: &str = "/* a-[0]-400-normal */\n@font-face {\n  font-family: 'A';\n  font-style: normal;\n  font-display: swap;\n  font-weight: 400;\n  src: url(./files/a-0-400-normal.woff2) format('woff2'), url(./files/a-0-400-normal.woff) format('woff');\n  unicode-range: U+25ee8,U+25f23;\n}\n";

    #[test]
    fn css_keeps_only_woff2_and_numbers_the_files() {
        let parsed = parse_font_css(&format!("{FACE}{}", FACE.replace("-0-", "-1-")), 3).unwrap();
        assert_eq!(parsed.files, ["a-0-400-normal.woff2", "a-1-400-normal.woff2"]);
        assert!(parsed.css.contains("src:url(\"3.woff2\") format('woff2')"));
        assert!(parsed.css.contains("src:url(\"4.woff2\") format('woff2')"));
        assert!(parsed.css.contains("unicode-range: U+25ee8,U+25f23"));
        assert!(!parsed.css.contains("files/"));
        assert!(!parsed.css.contains(".woff)"));
    }

    #[test]
    fn css_keeps_the_variable_font_format() {
        let css = "@font-face { font-family: 'V'; font-weight: 100 900; src: url(./files/v-0-wght-normal.woff2) format('woff2-variations'); }";
        let parsed = parse_font_css(css, 0).unwrap();
        assert!(parsed.css.contains("src:url(\"0.woff2\") format('woff2-variations')"));
    }

    #[test]
    fn css_refuses_other_places_and_other_shapes() {
        for bad in [
            "",
            "@font-face { src: url(https://evil.test/a.woff2) format('woff2'); }",
            "@font-face { src: url(./files/../../a.woff2) format('woff2'); }",
            "@font-face { src: url(./files/a.exe) format('woff2'); }",
            "@font-face { src: url(./files/a.woff2) format('woff2'); background: url(x.png); }",
            "@font-face { src: url(./files/a.woff2) format('woff2');",
        ] {
            assert!(parse_font_css(bad, 0).is_err(), "{bad}");
        }
    }

    #[test]
    fn unknown_key_has_no_source() {
        assert!(sources_of("noto").is_ok());
        assert!(sources_of("../../evil").is_err());
        assert!(sources_of("system").is_err());
    }

    /// 1 回の接続に 1 つ返す偽の取得元。files は名前 → (状態, 本文)
    fn fake_cdn(files: HashMap<&'static str, (u16, Vec<u8>)>) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let mut stream = stream;
                let mut buf = [0u8; 2048];
                let n = stream.read(&mut buf).unwrap_or(0);
                let head = String::from_utf8_lossy(&buf[..n]).to_string();
                let path = head.split_whitespace().nth(1).unwrap_or("").to_string();
                let (status, body) = files.iter().find(|(k, _)| path.ends_with(**k)).map_or((404, Vec::new()), |(_, (s, b))| (*s, b.clone()));
                let _ = write!(stream, "HTTP/1.1 {status} X\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                let _ = stream.write_all(&body);
            }
        });
        format!("http://127.0.0.1:{port}/")
    }

    fn woff2() -> Vec<u8> {
        [WOFF2_MAGIC, b"body"].concat()
    }

    fn run(base: &str, name: &str, cancel: bool) -> (Result<(), DownloadError>, PathBuf, Vec<(usize, usize)>) {
        let dir = std::env::temp_dir().join(format!("obb-font-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let seen: Arc<Mutex<Vec<(usize, usize)>>> = Arc::default();
        let log = seen.clone();
        let progress: Arc<dyn Fn(usize, usize) + Send + Sync> = Arc::new(move |d, t| log.lock().unwrap().push((d, t)));
        let result = tauri::async_runtime::block_on(download_font_files(
            base,
            &dir,
            "k",
            &["pkg@5/400.css"],
            Arc::new(AtomicBool::new(cancel)),
            progress,
        ));
        let seen = seen.lock().unwrap().clone();
        (result, dir, seen)
    }

    #[test]
    fn download_places_the_font_only_when_everything_arrived() {
        let base = fake_cdn(HashMap::from([
            ("pkg@5/400.css", (200, format!("{FACE}{}", FACE.replace("-0-", "-1-")).into_bytes())),
            ("files/a-0-400-normal.woff2", (200, woff2())),
            ("files/a-1-400-normal.woff2", (200, woff2())),
        ]));
        let (result, dir, seen) = run(&base, "ok", false);
        assert_eq!(result, Ok(()));
        assert!(is_ready(&dir, "k"));
        assert!(dir.join("k").join("0.woff2").is_file());
        assert!(dir.join("k").join("1.woff2").is_file());
        assert!(!dir.join(".tmp-k").exists());
        assert_eq!(seen.first(), Some(&(0, 2)));
        assert_eq!(seen.last().map(|p| p.0), Some(2));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn download_failure_says_why_and_leaves_nothing() {
        let base = fake_cdn(HashMap::from([
            ("pkg@5/400.css", (200, FACE.as_bytes().to_vec())),
            ("files/a-0-400-normal.woff2", (500, Vec::new())),
        ]));
        let (result, dir, _) = run(&base, "http", false);
        assert_eq!(result, Err(DownloadError::Failed("取得元がエラーを返しました(HTTP 500)".to_string())));
        assert!(!is_ready(&dir, "k"));
        assert!(!dir.join(".tmp-k").exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn download_refuses_what_is_not_a_font() {
        let base = fake_cdn(HashMap::from([
            ("pkg@5/400.css", (200, FACE.as_bytes().to_vec())),
            ("files/a-0-400-normal.woff2", (200, b"<html>".to_vec())),
        ]));
        let (result, dir, _) = run(&base, "html", false);
        assert!(matches!(result, Err(DownloadError::Failed(_))));
        assert!(!is_ready(&dir, "k"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn download_does_not_follow_redirects() {
        let base = fake_cdn(HashMap::from([("pkg@5/400.css", (302, Vec::new()))]));
        let (result, dir, _) = run(&base, "redirect", false);
        assert_eq!(result, Err(DownloadError::Failed("取得元がエラーを返しました(HTTP 302)".to_string())));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn canceled_download_leaves_nothing() {
        let base = fake_cdn(HashMap::from([("pkg@5/400.css", (200, FACE.as_bytes().to_vec()))]));
        let (result, dir, _) = run(&base, "cancel", true);
        assert_eq!(result, Err(DownloadError::Canceled));
        assert!(!is_ready(&dir, "k"));
        assert!(!dir.join(".tmp-k").exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    /// 本物の取得元から 1 書体取る。cargo test -- --ignored のときだけ
    #[test]
    #[ignore]
    fn real_cdn_serves_a_font() {
        let (result, dir, seen) = {
            let dir = std::env::temp_dir().join(format!("obb-font-real-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            let seen: Arc<Mutex<Vec<(usize, usize)>>> = Arc::default();
            let log = seen.clone();
            let progress: Arc<dyn Fn(usize, usize) + Send + Sync> = Arc::new(move |d, t| log.lock().unwrap().push((d, t)));
            let result = tauri::async_runtime::block_on(download_font_files(CDN, &dir, "kosugi-maru", sources_of("kosugi-maru").unwrap(), Arc::new(AtomicBool::new(false)), progress));
            let seen = seen.lock().unwrap().clone();
            (result, dir, seen)
        };
        assert_eq!(result, Ok(()));
        assert!(is_ready(&dir, "kosugi-maru"));
        assert!(seen.last().unwrap().1 > 100);
        let _ = std::fs::remove_dir_all(dir);
    }
}

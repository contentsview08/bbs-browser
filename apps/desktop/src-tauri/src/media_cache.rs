//! 画像のディスクキャッシュ。表示(obb-media プロトコル)と保存(save_image)が同じファイルを使い、同じ画像を二度取らない。
//! ファイル名は URL のハッシュだけなので、URL からデータフォルダの外を指せない。
//! 動画はここを通さない(プロトコルの応答は全体を一度に返す作りで、シークの範囲指定を受けられないため)。保存のときだけ一時的に置く。
//! 自動で読む取得は、名前を引いた先の IP も確かめ、家の中のアドレスへはつながない

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::io::Write;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use sha2::{Digest, Sha256};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};
use tauri_plugin_http::reqwest;
use tokio::sync::{watch, Notify, Semaphore};

use crate::{https_of, media_extension, percent_decode};

pub const SCHEME: &str = "obb-media";
/// 別のサイトを開く窓(画像の置き場のサイトの画面)から、アプリに取得させないため
const ALLOWED_WEBVIEWS: [&str; 3] = ["main", "settings", "ng"];
const MAX_BYTES: u64 = 1024 * 1024 * 1024;
/// 画像 1 件の上限。表示のときは全体をメモリに読むので、これより大きいものは置かない
const MAX_IMAGE_BYTES: u64 = 50 * 1024 * 1024;
/// 上限を超えたら、毎回消さずに済むよう少し余裕を作る
const TRIM_TO_BYTES: u64 = MAX_BYTES / 10 * 9;
/// 画面の表示と保存を合わせた、通信の上限。配信元に負担をかけない控えめな値
const MAX_FETCHES: usize = 6;
const MAX_FETCHES_PER_HOST: usize = 2;
const MAX_REDIRECTS: usize = 5;
const STALE_PART: Duration = Duration::from_secs(24 * 60 * 60);
/// 開くたびに書き込まないよう、古いものの判定に要る細かさでだけ使った時刻を更新する
const TOUCH_INTERVAL: Duration = Duration::from_secs(60 * 60);
/// WebView が読んでいたときと同じくブラウザとして名乗る(Monazilla の名乗りを断る置き場がある)
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) OBB";

type FlightResult = Option<Result<PathBuf, String>>;

/// 取得中の 1 件。同じ画像を頼んだ人はこれを待つ
struct Flight {
    done: watch::Sender<FlightResult>,
    canceled: AtomicBool,
    cancel: Notify,
}

impl Flight {
    fn new() -> Self {
        Self { done: watch::channel(None).0, canceled: AtomicBool::new(false), cancel: Notify::new() }
    }

    async fn or_cancel<T>(&self, work: impl Future<Output = T>) -> Result<T, FetchError> {
        let notified = self.cancel.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        if self.canceled.load(Ordering::SeqCst) {
            return Err(FetchError::Stop("取り消しました".into()));
        }
        tokio::select! {
            r = work => Ok(r),
            _ = notified => Err(FetchError::Stop("取り消しました".into())),
        }
    }
}

enum FetchError {
    /// つながらなかった。https なら、このホストは次から http へ直接行く
    Connect(String),
    /// 失敗の返事。https なら http でも試す
    Status(String),
    /// 取り消し・読んではいけない行き先・画像でない中身。別の URL でも試さない
    Stop(String),
}

impl FetchError {
    fn message(self) -> String {
        match self {
            Self::Connect(m) | Self::Status(m) | Self::Stop(m) => m,
        }
    }
}

pub struct MediaCache {
    dir: PathBuf,
    /// 自動で読む取得。名前を引いた先が家の中なら、つながない
    client: reqwest::Client,
    /// 押して読むことにした取得(fetch_uncached)。行き先を確かめない
    direct: reqwest::Client,
    allow: Box<dyn Fn(&str) -> bool + Send + Sync>,
    flights: Mutex<HashMap<String, Arc<Flight>>>,
    fetches: Arc<Semaphore>,
    hosts: Mutex<HashMap<String, Arc<Semaphore>>>,
    http_only: Mutex<HashSet<String>>,
    /// 使っている大きさ。起動を遅くしないよう、最初に保存するときに数える
    total: Mutex<Option<u64>>,
    part_seq: AtomicU64,
}

impl MediaCache {
    pub fn new(dir: PathBuf, allow: impl Fn(&str) -> bool + Send + Sync + 'static) -> Result<Self, String> {
        let builder = || {
            reqwest::Client::builder()
                .user_agent(USER_AGENT)
                .connect_timeout(Duration::from_secs(15))
                .read_timeout(Duration::from_secs(30))
                // 行き先を 1 段ずつ確かめるので、自動でたどらない
                .redirect(reqwest::redirect::Policy::none())
        };
        let client = builder().dns_resolver(Arc::new(PublicOnly)).build().map_err(|e| e.to_string())?;
        let direct = builder().build().map_err(|e| e.to_string())?;
        Ok(Self {
            dir,
            client,
            direct,
            allow: Box::new(allow),
            flights: Mutex::default(),
            fetches: Arc::new(Semaphore::new(MAX_FETCHES)),
            hosts: Mutex::default(),
            http_only: Mutex::default(),
            total: Mutex::new(None),
            part_seq: AtomicU64::new(0),
        })
    }

    pub fn is_allowed(&self, url: &str) -> bool {
        (self.allow)(url)
    }

    fn path_of(&self, url: &str) -> PathBuf {
        self.dir.join(cache_key(url))
    }

    /// 手元にあるファイル。使った時刻を更新する(古いものから消すため)
    pub fn cached(&self, url: &str) -> Option<PathBuf> {
        let path = self.path_of(url);
        let meta = std::fs::metadata(&path).ok()?;
        if meta.len() == 0 {
            return None;
        }
        let old = meta.modified().ok().and_then(|m| m.elapsed().ok()).is_some_and(|age| age > TOUCH_INTERVAL);
        if old {
            if let Ok(file) = std::fs::File::options().write(true).open(&path) {
                let _ = file.set_modified(SystemTime::now());
            }
        }
        Some(path)
    }

    /// 画像のファイルを返す。なければ取ってきて置く。戻り値の bool は、通信せずに済んだか。
    /// videos は保存のときだけ true(表示の経路で動画を置くと、使用量に数えないので 1 GB の上限が効かない)
    pub async fn ensure(self: &Arc<Self>, url: &str, videos: bool) -> Result<(PathBuf, bool), String> {
        if !self.is_allowed(url) {
            return Err("家の中のアドレスは自動で読みません".into());
        }
        if let Some(path) = self.cached(url) {
            return Ok((path, true));
        }
        // 動画を受けるかで結果が違うので、同じ URL でも別の取得として待ち合わせる
        let key = cache_key(url);
        let flight_key = if videos { format!("{key}+video") } else { key.clone() };
        let (flight, leader) = {
            let mut flights = self.flights.lock().unwrap();
            // 調べてからここまでの間に別の取得が終わっていたら、もう取らない
            if let Some(path) = self.cached(url) {
                return Ok((path, true));
            }
            match flights.get(&flight_key) {
                Some(f) => (f.clone(), false),
                None => {
                    let f = Arc::new(Flight::new());
                    flights.insert(flight_key.clone(), f.clone());
                    (f, true)
                }
            }
        };
        if leader {
            // 頼んだ人(画面の要求)がいなくなっても、取り消されるまでは最後まで取って置く
            let this = self.clone();
            let (url, flight) = (url.to_string(), flight.clone());
            tauri::async_runtime::spawn(async move {
                let result = this.fetch_and_store(&url, &flight, videos).await;
                this.flights.lock().unwrap().remove(&flight_key);
                let stored = result.as_ref().ok().cloned();
                let _ = flight.done.send(Some(result));
                if let Some(path) = stored {
                    let this = this.clone();
                    let _ = tauri::async_runtime::spawn_blocking(move || this.note_stored(&path)).await;
                }
            });
        }
        let mut rx = flight.done.subscribe();
        let result = rx.wait_for(Option::is_some).await.map_err(|e| e.to_string())?.clone();
        result.expect("wait_for で確かめた").map(|path| (path, false))
    }

    /// 取得を取り消す。同じ画像を待っている人にも失敗が返る
    pub fn cancel(&self, url: &str) {
        let key = cache_key(url);
        let flights = self.flights.lock().unwrap();
        for f in [flights.get(&key), flights.get(&format!("{key}+video"))].into_iter().flatten() {
            f.canceled.store(true, Ordering::SeqCst);
            f.cancel.notify_waiters();
        }
    }

    /// 置かずに一時ファイルへ取る(押して読むことにした家の中のアドレス)。行き先は確かめない
    pub async fn fetch_uncached(&self, url: &str) -> Result<PathBuf, String> {
        std::fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let part = self.part_path("direct");
        let flight = Flight::new();
        match self.fetch_with_fallback(url, &part, &flight, false, true).await {
            Ok(()) => Ok(part),
            Err(e) => {
                let _ = std::fs::remove_file(&part);
                Err(e.message())
            }
        }
    }

    async fn fetch_and_store(&self, url: &str, flight: &Flight, videos: bool) -> Result<PathBuf, String> {
        std::fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let path = self.path_of(url);
        let part = self.part_path(&cache_key(url));
        // 全部届いてから名前を変えるので、途中で切れたものをキャッシュとして読むことはない
        let result = match self.fetch_with_fallback(url, &part, flight, true, videos).await {
            Ok(()) => std::fs::rename(&part, &path).map(|()| path).map_err(|e| e.to_string()),
            Err(e) => Err(e.message()),
        };
        if result.is_err() {
            let _ = std::fs::remove_file(&part);
        }
        result
    }

    fn part_path(&self, name: &str) -> PathBuf {
        let seq = self.part_seq.fetch_add(1, Ordering::Relaxed);
        self.dir.join(format!("{name}.{seq}.part"))
    }

    /// https を先に試し、だめなら書いてあるとおりの URL で取る(utils/httpsFirst.ts と同じ考え方)
    async fn fetch_with_fallback(&self, url: &str, part: &Path, flight: &Flight, check: bool, videos: bool) -> Result<(), FetchError> {
        let _total = flight.or_cancel(self.fetches.clone().acquire_owned()).await?;
        let host = host_of(url);
        let per_host = self.host_slots(&host);
        let _host = flight.or_cancel(per_host.acquire_owned()).await?;
        let known_http = self.http_only.lock().unwrap().contains(&host);
        if let Some(https) = https_of(url).filter(|_| !known_http) {
            match self.fetch_following(&https, part, flight, check, videos).await {
                Ok(()) => return Ok(()),
                Err(FetchError::Stop(m)) => return Err(FetchError::Stop(m)),
                Err(FetchError::Connect(_)) => {
                    self.http_only.lock().unwrap().insert(host);
                }
                Err(FetchError::Status(_)) => {}
            }
        }
        self.fetch_following(url, part, flight, check, videos).await
    }

    fn host_slots(&self, host: &str) -> Arc<Semaphore> {
        let mut hosts = self.hosts.lock().unwrap();
        if hosts.len() > 256 {
            hosts.retain(|_, s| Arc::strong_count(s) > 1);
        }
        hosts.entry(host.to_string()).or_insert_with(|| Arc::new(Semaphore::new(MAX_FETCHES_PER_HOST))).clone()
    }

    /// リダイレクトを 1 段ずつ、行き先を確かめながらたどる
    async fn fetch_following(&self, url: &str, part: &Path, flight: &Flight, check: bool, videos: bool) -> Result<(), FetchError> {
        let client = if check { &self.client } else { &self.direct };
        let mut current = url.to_string();
        for _ in 0..=MAX_REDIRECTS {
            if check && !self.is_allowed(&current) {
                return Err(FetchError::Stop("家の中のアドレスへの転送は読みません".into()));
            }
            let request = client.get(&current).header(header::ACCEPT, "image/*,*/*;q=0.8").send();
            let res = flight.or_cancel(request).await?.map_err(|e| {
                if is_private_refusal(&e) {
                    FetchError::Stop("家の中のアドレスは自動で読みません".into())
                } else if e.is_connect() || e.is_timeout() {
                    FetchError::Connect(e.to_string())
                } else {
                    FetchError::Status(e.to_string())
                }
            })?;
            if res.status().is_redirection() {
                let next = res
                    .headers()
                    .get(header::LOCATION)
                    .and_then(|l| l.to_str().ok())
                    .and_then(|l| res.url().join(l).ok())
                    .ok_or_else(|| FetchError::Status("転送先が分かりません".into()))?;
                current = next.to_string();
                continue;
            }
            if !res.status().is_success() {
                return Err(FetchError::Status(format!("HTTP {}", res.status().as_u16())));
            }
            return write_body(res, part, flight, videos).await;
        }
        Err(FetchError::Stop("転送が多すぎます".into()))
    }

    /// 置いた分を数え、上限を超えたら古いものから消す。動画は保存ですぐ外へ移すので数えない
    fn note_stored(&self, path: &Path) {
        if read_head(path).as_deref().is_some_and(is_video) {
            return;
        }
        let size = std::fs::metadata(path).map_or(0, |m| m.len());
        let mut total = self.total.lock().unwrap();
        let used = match *total {
            Some(t) => t + size,
            None => self.scan().iter().map(|f| f.size).sum(),
        };
        *total = Some(if used > MAX_BYTES { self.trim(path) } else { used });
    }

    fn scan(&self) -> Vec<CacheFile> {
        let Ok(entries) = std::fs::read_dir(&self.dir) else { return Vec::new() };
        let mut files = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = entry.metadata() else { continue };
            let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.ends_with(".part") {
                // 途中で終了したときの残り
                if modified.elapsed().is_ok_and(|age| age > STALE_PART) {
                    let _ = std::fs::remove_file(&path);
                }
            } else if meta.is_file() && is_cache_name(&name) {
                files.push(CacheFile { path, size: meta.len(), modified });
            }
        }
        files
    }

    fn trim(&self, keep: &Path) -> u64 {
        let mut files = self.scan();
        let mut used: u64 = files.iter().map(|f| f.size).sum();
        files.sort_by_key(|f| f.modified);
        for f in files {
            if used <= TRIM_TO_BYTES {
                break;
            }
            if f.path != keep && std::fs::remove_file(&f.path).is_ok() {
                used -= f.size;
            }
        }
        used
    }

    pub fn usage(&self) -> MediaCacheUsage {
        let files = self.scan();
        MediaCacheUsage { bytes: files.iter().map(|f| f.size).sum(), files: files.len() }
    }

    pub fn clear(&self) -> MediaCacheUsage {
        let mut total = self.total.lock().unwrap();
        for f in self.scan() {
            let _ = std::fs::remove_file(&f.path);
        }
        // 読んでいて消せなかったものが残ることがあるので数え直す
        let left = self.usage();
        *total = Some(left.bytes);
        left
    }
}

struct CacheFile {
    path: PathBuf,
    size: u64,
    modified: SystemTime,
}

#[derive(serde::Serialize)]
pub struct MediaCacheUsage {
    bytes: u64,
    files: usize,
}

/// 届くそばからファイルへ書く。先頭で画像・動画でないと分かれば、残りを取らずにやめる。
/// 画像は MAX_IMAGE_BYTES まで(大きさの申告が超えていれば取らず、届いた分が超えたらやめる)。動画は videos のときだけ受け、大きさは見ない
async fn write_body(mut res: reqwest::Response, part: &Path, flight: &Flight, videos: bool) -> Result<(), FetchError> {
    let declared = res.content_length();
    if !videos && declared.is_some_and(|n| n > MAX_IMAGE_BYTES) {
        return Err(too_large());
    }
    let stop = |e: std::io::Error| FetchError::Stop(e.to_string());
    let mut file = std::fs::File::create(part).map_err(stop)?;
    let mut head: Vec<u8> = Vec::with_capacity(HEAD_BYTES);
    // 先頭を見るまでは画像として数える
    let mut limit = Some(MAX_IMAGE_BYTES);
    let mut written: u64 = 0;
    let mut checked = false;
    while let Some(chunk) = flight.or_cancel(res.chunk()).await?.map_err(|e| FetchError::Connect(e.to_string()))? {
        file.write_all(&chunk).map_err(stop)?;
        written += chunk.len() as u64;
        if !checked {
            head.extend_from_slice(&chunk[..chunk.len().min(HEAD_BYTES - head.len())]);
            if head.len() >= HEAD_BYTES {
                checked = true;
                limit = check_media(&head, videos)?;
                if limit.zip(declared).is_some_and(|(l, n)| n > l) {
                    return Err(too_large());
                }
            }
        }
        if limit.is_some_and(|l| written > l) {
            return Err(too_large());
        }
    }
    if !checked {
        check_media(&head, videos)?;
    }
    Ok(())
}

fn too_large() -> FetchError {
    FetchError::Stop("画像が大きすぎるので読みませんでした".into())
}

const HEAD_BYTES: usize = 16;

/// 画像なら大きさの上限を、受けてよい動画なら None を返す
fn check_media(head: &[u8], videos: bool) -> Result<Option<u64>, FetchError> {
    if media_extension(head).is_none() {
        return Err(FetchError::Stop("画像でも動画でもないので読みませんでした".into()));
    }
    match is_video(head) {
        false => Ok(Some(MAX_IMAGE_BYTES)),
        true if videos => Ok(None),
        true => Err(FetchError::Stop("動画は画像として読みません".into())),
    }
}

pub fn read_head(path: &Path) -> Option<Vec<u8>> {
    use std::io::Read;
    let mut head = vec![0; HEAD_BYTES];
    let n = std::fs::File::open(path).ok()?.read(&mut head).ok()?;
    head.truncate(n);
    Some(head)
}

pub fn is_video(head: &[u8]) -> bool {
    matches!(media_extension(head), Some("mp4" | "mov" | "webm"))
}

/// 中身で決める(配信元の Content-Type は信じない。text/html などとして WebView に渡さないため)
fn image_mime(head: &[u8]) -> Option<&'static str> {
    Some(match media_extension(head)? {
        "jpg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "heic" => "image/heic",
        _ => return None,
    })
}

/// http と https は同じ画像として扱う(表示も保存も https を先に試すので)。# 以降はサーバーへ送られない
fn cache_key(url: &str) -> String {
    let url = url.split('#').next().unwrap_or(url);
    let normalized = https_of(url).unwrap_or_else(|| url.to_string());
    Sha256::digest(normalized.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

fn is_cache_name(name: &str) -> bool {
    name.len() == 64 && name.bytes().all(|b| b.is_ascii_hexdigit())
}

fn host_of(url: &str) -> String {
    reqwest::Url::parse(url).ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_else(|| url.to_string())
}

/// 画面に出しただけで読みに行ってよい URL か。utils/safeUrl.ts の isAutoLoadable と同じ決まり
pub fn is_auto_loadable(url: &str) -> bool {
    let Ok(u) = reqwest::Url::parse(url) else { return false };
    if !matches!(u.scheme(), "http" | "https") || u.port().is_some() {
        return false;
    }
    let Some(host) = u.host_str() else { return false };
    let host = host.to_ascii_lowercase();
    let host = host.trim_end_matches('.');
    let local_suffix = [".local", ".localhost", ".lan", ".home", ".internal", ".intranet", ".corp", ".home.arpa"];
    if host == "localhost" || local_suffix.iter().any(|s| host.ends_with(s)) || host.starts_with('[') {
        return false;
    }
    if let Ok(ip) = host.parse::<Ipv4Addr>() {
        return !is_private_ip(IpAddr::V4(ip));
    }
    if host.bytes().all(|c| c.is_ascii_digit() || c == b'.') || host.starts_with("0x") || host.contains(".0x") {
        return false;
    }
    host.contains('.')
}

/// 家の中・自分の PC・使えないアドレスか(is_auto_loadable の IP の決まりと、名前を引いた先の確かめで共通)
fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let [a, b, ..] = v4.octets();
            a == 0
                || a == 10
                || a == 127
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && b == 168)
                || a >= 224
        }
        IpAddr::V6(v6) => {
            let seg = v6.segments();
            // v4 射影(::ffff:a.b.c.d)・v4 互換(::a.b.c.d)・NAT64(64:ff9b::a.b.c.d)は、中の IPv4 で決める
            let embeds_v4 = (seg[..5] == [0; 5] && (seg[5] == 0xffff || seg[5] == 0)) || seg[..6] == [0x64, 0xff9b, 0, 0, 0, 0];
            if embeds_v4 && !v6.is_unspecified() && !v6.is_loopback() {
                let [.., a, b, c, d] = v6.octets();
                return is_private_ip(IpAddr::V4(Ipv4Addr::new(a, b, c, d)));
            }
            v6.is_unspecified()
                || v6.is_loopback()
                || (seg[0] & 0xfe00) == 0xfc00
                || (seg[0] & 0xffc0) == 0xfe80
                || (seg[0] & 0xff00) == 0xff00
        }
    }
}

/// 名前を引いた先のうち、家の中でないアドレスだけを返す。残らなければつながない。
/// 字面では外に見える名前(192.168.0.1.nip.io など)で、家の中の機器へ自動で GET を送らないため
struct PublicOnly;

#[derive(Debug)]
struct PrivateAddress;

impl std::fmt::Display for PrivateAddress {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("家の中のアドレスを指す名前です")
    }
}

impl std::error::Error for PrivateAddress {}

fn public_only(addrs: impl Iterator<Item = SocketAddr>) -> Result<Vec<SocketAddr>, PrivateAddress> {
    let addrs: Vec<SocketAddr> = addrs.collect();
    let public: Vec<SocketAddr> = addrs.iter().copied().filter(|a| !is_private_ip(a.ip())).collect();
    if public.is_empty() && !addrs.is_empty() {
        return Err(PrivateAddress);
    }
    Ok(public)
}

impl reqwest::dns::Resolve for PublicOnly {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let found = tokio::net::lookup_host((host.as_str(), 0)).await?;
            let addrs: reqwest::dns::Addrs = Box::new(public_only(found)?.into_iter());
            Ok(addrs)
        })
    }
}

/// 名前を引いた先が家の中だったために、つながなかったか
fn is_private_refusal(e: &reqwest::Error) -> bool {
    let mut source: Option<&(dyn std::error::Error + 'static)> = Some(e);
    while let Some(err) = source {
        if err.is::<PrivateAddress>() {
            return true;
        }
        source = err.source();
    }
    false
}

fn respond_status(responder: UriSchemeResponder, status: StatusCode) {
    let response = Response::builder().status(status).header(header::CACHE_CONTROL, "no-store").body(Vec::new());
    if let Ok(response) = response {
        responder.respond(response);
    }
}

/// 表示する画像を読む。大きさと先頭を見てから読む(前の版が置いた大きな動画などを、まるごとメモリに読まない)
fn read_image(path: &Path) -> Result<(Vec<u8>, &'static str), StatusCode> {
    let size = std::fs::metadata(path).map_err(|_| StatusCode::BAD_GATEWAY)?.len();
    let mime = read_head(path).as_deref().and_then(image_mime).ok_or(StatusCode::UNSUPPORTED_MEDIA_TYPE)?;
    if size > MAX_IMAGE_BYTES {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }
    let bytes = std::fs::read(path).map_err(|_| StatusCode::BAD_GATEWAY)?;
    Ok((bytes, mime))
}

/// obb-media://localhost/<URL を encodeURIComponent したもの>(Windows は http://obb-media.localhost/<同じ>)
pub fn handle_protocol<R: Runtime>(ctx: UriSchemeContext<'_, R>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    if !ALLOWED_WEBVIEWS.contains(&ctx.webview_label()) || request.method() != tauri::http::Method::GET {
        return respond_status(responder, StatusCode::FORBIDDEN);
    }
    let url = percent_decode(request.uri().path().trim_start_matches('/'));
    let Some(cache) = ctx.app_handle().try_state::<Arc<MediaCache>>().map(|s| s.inner().clone()) else {
        return respond_status(responder, StatusCode::SERVICE_UNAVAILABLE);
    };
    tauri::async_runtime::spawn(async move {
        let path = match cache.ensure(&url, false).await {
            Ok((path, _)) => path,
            // 理由は画面の「取得できません」が出す。WebView にはどの失敗も読めない画像として見える
            Err(_) => return respond_status(responder, StatusCode::BAD_GATEWAY),
        };
        let read = tauri::async_runtime::spawn_blocking(move || read_image(&path)).await;
        let (bytes, mime) = match read {
            Ok(Ok(found)) => found,
            Ok(Err(status)) => return respond_status(responder, status),
            Err(_) => return respond_status(responder, StatusCode::BAD_GATEWAY),
        };
        let response = Response::builder()
            .header(header::CONTENT_TYPE, mime)
            .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
            // 中身はもう手元にあるので、WebView のディスクに二重に置かせない
            .header(header::CACHE_CONTROL, "no-store")
            .body(bytes);
        match response {
            Ok(response) => responder.respond(response),
            Err(_) => respond_status(responder, StatusCode::INTERNAL_SERVER_ERROR),
        }
    });
}

#[tauri::command]
pub fn media_cached(cache: tauri::State<'_, Arc<MediaCache>>, urls: Vec<String>) -> Vec<bool> {
    urls.iter().map(|u| cache.cached(u).is_some()).collect()
}

#[tauri::command]
pub fn cancel_media(cache: tauri::State<'_, Arc<MediaCache>>, url: String) {
    cache.cancel(&url);
}

#[tauri::command]
pub async fn media_cache_usage(cache: tauri::State<'_, Arc<MediaCache>>) -> Result<MediaCacheUsage, String> {
    let cache = cache.inner().clone();
    tauri::async_runtime::spawn_blocking(move || cache.usage()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn media_cache_clear(cache: tauri::State<'_, Arc<MediaCache>>) -> Result<MediaCacheUsage, String> {
    let cache = cache.inner().clone();
    tauri::async_runtime::spawn_blocking(move || cache.clear()).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::net::TcpListener;
    use std::sync::atomic::AtomicUsize;

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 13, 10, 26, 10, 0, 0, 0, 13, b'I', b'H', b'D', b'R', 1, 2, 3, 4];

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("obb-media-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    /// GET を数える偽サーバー。path ごとの応答は answer で決める
    fn fake_server(answer: impl Fn(&str) -> Vec<u8> + Send + Sync + 'static) -> (String, Arc<AtomicUsize>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let count = Arc::new(AtomicUsize::new(0));
        let counter = count.clone();
        let answer = Arc::new(answer);
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let (counter, answer) = (counter.clone(), answer.clone());
                std::thread::spawn(move || {
                    let mut reader = BufReader::new(stream.try_clone().unwrap());
                    let mut stream = stream;
                    loop {
                        let mut line = String::new();
                        // https を試した分(文字でないバイト列)は数えない
                        if reader.read_line(&mut line).unwrap_or(0) == 0 || !line.starts_with("GET ") {
                            return;
                        }
                        let path = line.split(' ').nth(1).unwrap_or("/").to_string();
                        loop {
                            let mut h = String::new();
                            if reader.read_line(&mut h).unwrap_or(0) == 0 || h == "\r\n" {
                                break;
                            }
                        }
                        counter.fetch_add(1, Ordering::SeqCst);
                        if stream.write_all(&answer(&path)).is_err() {
                            return;
                        }
                    }
                });
            }
        });
        (origin, count)
    }

    fn ok_png() -> Vec<u8> {
        let mut out = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n", PNG.len()).into_bytes();
        out.extend_from_slice(PNG);
        out
    }

    fn cache(name: &str, allow: impl Fn(&str) -> bool + Send + Sync + 'static) -> Arc<MediaCache> {
        Arc::new(MediaCache::new(temp_dir(name), allow).unwrap())
    }

    #[test]
    fn second_read_does_not_touch_the_server() {
        let (origin, count) = fake_server(|_| ok_png());
        let cache = cache("second", |_| true);
        let url = format!("{origin}/a.png");
        tauri::async_runtime::block_on(async {
            assert!(!cache.ensure(&url, false).await.unwrap().1);
            let (path, hit) = cache.ensure(&url, false).await.unwrap();
            assert!(hit);
            assert_eq!(std::fs::read(path).unwrap(), PNG);
        });
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn same_image_at_the_same_time_is_fetched_once() {
        let (origin, count) = fake_server(|_| {
            std::thread::sleep(Duration::from_millis(200));
            ok_png()
        });
        let cache = cache("flight", |_| true);
        let url = format!("{origin}/a.png");
        tauri::async_runtime::block_on(async {
            let tasks: Vec<_> = (0..5)
                .map(|_| {
                    let (cache, url) = (cache.clone(), url.clone());
                    tauri::async_runtime::spawn(async move { cache.ensure(&url, false).await.map(|r| r.0) })
                })
                .collect();
            for t in tasks {
                t.await.unwrap().unwrap();
            }
        });
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn redirect_to_a_forbidden_address_is_not_followed() {
        let (inner, inner_count) = fake_server(|_| ok_png());
        let target = inner.clone();
        let (outer, outer_count) = fake_server(move |_| format!("HTTP/1.1 302 Found\r\nLocation: {target}/secret.png\r\nContent-Length: 0\r\n\r\n").into_bytes());
        let allowed = outer.clone();
        let cache = cache("redirect", move |u: &str| u.contains(allowed.trim_start_matches("http://")));
        let result = tauri::async_runtime::block_on(cache.ensure(&format!("{outer}/a.png"), false));
        assert!(result.is_err());
        assert_eq!(outer_count.load(Ordering::SeqCst), 1);
        assert_eq!(inner_count.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn non_media_is_not_stored() {
        let (origin, _) = fake_server(|_| b"HTTP/1.1 200 OK\r\nContent-Length: 20\r\n\r\n<html>not an image<>".to_vec());
        let cache = cache("html", |_| true);
        let url = format!("{origin}/a.png");
        assert!(tauri::async_runtime::block_on(cache.ensure(&url, false)).is_err());
        assert!(cache.cached(&url).is_none());
    }

    #[test]
    fn canceled_transfer_is_not_stored() {
        let (origin, _) = fake_server(|_| {
            let mut out = b"HTTP/1.1 200 OK\r\nContent-Length: 9999\r\nConnection: close\r\n\r\n".to_vec();
            out.extend_from_slice(PNG);
            out
        });
        let cache = cache("broken", |_| true);
        let url = format!("{origin}/a.png");
        // 接続は偽サーバーのスレッドが読み続けるので閉じない。読み取りの時間切れを待たないよう取り消す
        let result = tauri::async_runtime::block_on(async {
            let task = {
                let (cache, url) = (cache.clone(), url.clone());
                tauri::async_runtime::spawn(async move { cache.ensure(&url, false).await.map(|r| r.0) })
            };
            tokio::time::sleep(Duration::from_millis(500)).await;
            cache.cancel(&url);
            task.await.unwrap()
        });
        assert!(result.is_err());
        assert!(cache.cached(&url).is_none());
    }

    #[test]
    fn hash_names_cannot_leave_the_folder() {
        let cache = cache("hash", |_| true);
        let path = cache.path_of("https://a.test/../../etc/passwd?x=/../../y");
        assert_eq!(path.parent().unwrap(), cache.dir);
        assert!(is_cache_name(path.file_name().unwrap().to_str().unwrap()));
        assert_eq!(cache_key("http://a.test/x.png#t=1"), cache_key("https://a.test/x.png"));
        assert_ne!(cache_key("https://a.test/x.png?1"), cache_key("https://a.test/x.png?2"));
    }

    #[test]
    fn oldest_files_go_first_and_the_new_one_stays() {
        let cache = cache("trim", |_| true);
        std::fs::create_dir_all(&cache.dir).unwrap();
        let big = 400 * 1024 * 1024;
        let names = ["a", "b", "c"].map(cache_key);
        for (i, name) in names.iter().enumerate() {
            let file = std::fs::File::create(cache.dir.join(name)).unwrap();
            file.set_len(big).unwrap();
            file.set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(1000 * (i as u64 + 1))).unwrap();
        }
        let keep = cache.dir.join(&names[0]);
        let used = cache.trim(&keep);
        assert!(used <= TRIM_TO_BYTES);
        assert!(keep.exists(), "今置いたものは消さない");
        assert!(!cache.dir.join(&names[1]).exists(), "次に古いものから消す");
        assert!(cache.dir.join(&names[2]).exists());
    }

    #[test]
    fn auto_loadable_matches_safe_url() {
        for ok in ["https://a.test/x.png", "http://i.imgur.com/a.jpg", "https://8.8.8.8/a.png", "https://a.test:443/x.png"] {
            assert!(is_auto_loadable(ok), "{ok}");
        }
        for ng in [
            "http://localhost/a.png",
            "http://192.168.0.1/a.png",
            "http://10.0.0.1/a.png",
            "http://127.0.0.1/a.png",
            "http://0x7f.1/a.png",
            "http://[::1]/a.png",
            "http://router/a.png",
            "http://nas.local/a.png",
            "http://nas.home.arpa/a.png",
            "https://a.test:8080/x.png",
            "file:///etc/passwd",
            "ftp://a.test/x.png",
            "not a url",
        ] {
            assert!(!is_auto_loadable(ng), "{ng}");
        }
    }

    #[test]
    fn too_large_image_is_not_stored() {
        // 大きさの申告が上限を超えていれば、中身を待たずにやめる
        let (origin, _) = fake_server(|_| {
            let mut out = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n", MAX_IMAGE_BYTES + 1).into_bytes();
            out.extend_from_slice(PNG);
            out
        });
        let declared = cache("large-declared", |_| true);
        let url = format!("{origin}/a.png");
        assert!(tauri::async_runtime::block_on(declared.ensure(&url, false)).is_err());
        assert!(declared.cached(&url).is_none());

        // 申告がなくても、届いた分が上限を超えたらやめる
        let (origin, _) = fake_server(|_| {
            let mut out = b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n".to_vec();
            out.extend_from_slice(PNG);
            out.resize(out.len() + MAX_IMAGE_BYTES as usize, 0);
            out
        });
        let streamed = cache("large-streamed", |_| true);
        let url = format!("{origin}/a.png");
        assert!(tauri::async_runtime::block_on(streamed.ensure(&url, false)).is_err());
        assert!(streamed.cached(&url).is_none());
    }

    #[test]
    fn video_is_stored_only_for_saving() {
        const MP4: &[u8] = &[0, 0, 0, 0x18, b'f', b't', b'y', b'p', b'i', b's', b'o', b'm', 0, 0, 2, 0, 1, 2, 3, 4];
        let (origin, _) = fake_server(|_| {
            let mut out = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n", MP4.len()).into_bytes();
            out.extend_from_slice(MP4);
            out
        });
        let cache = cache("video", |_| true);
        let url = format!("{origin}/a.jpg");
        assert!(tauri::async_runtime::block_on(cache.ensure(&url, false)).is_err(), "表示の経路では置かない");
        assert!(cache.cached(&url).is_none());
        let (path, _) = tauri::async_runtime::block_on(cache.ensure(&url, true)).unwrap();
        assert_eq!(std::fs::read(path).unwrap(), MP4);
    }

    #[test]
    fn private_addresses_are_refused_after_lookup() {
        for ip in [
            "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "127.0.0.1", "169.254.1.1", "100.64.0.1", "0.0.0.0",
            "224.0.0.1", "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:192.168.0.1", "::ffff:127.0.0.1",
            "::10.0.0.1", "64:ff9b::c0a8:1",
        ] {
            assert!(is_private_ip(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["8.8.8.8", "172.32.0.1", "100.128.0.1", "2001:4860:4860::8888", "::ffff:8.8.8.8", "64:ff9b::808:808"] {
            assert!(!is_private_ip(ip.parse().unwrap()), "{ip}");
        }
        let addr = |s: &str| SocketAddr::new(s.parse().unwrap(), 0);
        assert!(public_only([addr("192.168.0.1"), addr("::1")].into_iter()).is_err());
        assert_eq!(public_only([addr("192.168.0.1"), addr("8.8.8.8")].into_iter()).unwrap(), vec![addr("8.8.8.8")]);
        // 名前が localhost に引けるので、字面の検査を通しても(allow が常に true でも)つながない
        let (origin, count) = fake_server(|_| ok_png());
        let port = origin.rsplit(':').next().unwrap().to_string();
        let cache = cache("resolve", |_| true);
        let result = tauri::async_runtime::block_on(cache.ensure(&format!("http://localhost:{port}/a.png"), false));
        assert!(result.is_err());
        assert_eq!(count.load(Ordering::SeqCst), 0);
    }
}

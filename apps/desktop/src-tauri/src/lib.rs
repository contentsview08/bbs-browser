use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::Manager;

use tauri_plugin_sql::{Migration, MigrationKind};

mod chosen_paths;
mod fonts;
mod google_auth;
mod media_cache;
#[cfg(test)]
mod oauth_env;
mod post_http;
mod save_name;
mod sql_batch;
mod sync_http;
mod sync_key;
mod sync_start;
mod web_upload;
#[cfg(desktop)]
mod window_state;

use chosen_paths::ChosenPaths;
use media_cache::MediaCache;

// ── データの置き場 ──
//
// ふつう(インストーラー版)は OS の決まりの場所(%APPDATA%\<identifier>\)。
// ZIP 版は「展開したフォルダがインストール先」: exe と同じフォルダに portable.txt か data フォルダがあれば、
// DB・設定・Cookie・背景画像をそのフォルダの data\ に置く(フォルダごと消せばまっさら、別の場所に展開すれば別のデータ)。
// Tauri とプラグインが自分で決める置き場(WebView2 のデータ・plugin-http の Cookie・キャッシュ)も、run() で data\ に寄せる。
// 置き場を決めるのはここだけ。ほかの所は app_data_dir()/app_config_dir() を直に呼ばず、data_dir()/db_dir() を使う

/// ZIP 版(ポータブル)のデータフォルダ。exe の隣に portable.txt か data\ があればそこ(なければ None)
pub(crate) fn portable_dir() -> Option<PathBuf> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let data = exe_dir.join("data");
    if data.is_dir() || exe_dir.join("portable.txt").is_file() {
        let _ = std::fs::create_dir_all(&data);
        Some(data)
    } else {
        None
    }
}

/// 旧 identifier(この名前のフォルダが旧版の置き場)
const OLD_IDENTIFIER: &str = "io.github.yumekui8.bbs-browser";

/// 旧 identifier の置き場に DB があり新しい置き場になければ、フォルダごと写す。
/// 旧版を使い続けられるよう移動はしない
fn migrate_old_data_dir(app: &tauri::AppHandle) {
    if portable_dir().is_some() {
        return;
    }
    let Ok(new_dir) = app.path().app_config_dir() else { return };
    if new_dir.join(DB_FILE).exists() {
        return;
    }
    let Some(parent) = new_dir.parent() else { return };
    let old_dir = parent.join(OLD_IDENTIFIER);
    if !old_dir.join(DB_FILE).exists() {
        return;
    }
    let _ = copy_dir_all(&old_dir, &new_dir);
}

fn copy_dir_all(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let src = entry.path();
        let dst = to.join(entry.file_name());
        if src.is_dir() {
            copy_dir_all(&src, &dst)?;
        } else {
            std::fs::copy(&src, &dst)?;
        }
    }
    Ok(())
}

/// このアプリが自分で入れ替えられるか。Windows のインストーラー版と Linux の AppImage だけ。
/// ZIP 版は入れ替える先がなく、.deb は管理者のパスワードが要るので、新しい版を通知で知らせるだけにする
#[tauri::command]
fn can_self_update() -> bool {
    if portable_dir().is_some() {
        return false;
    }
    if cfg!(target_os = "linux") {
        return std::env::var_os("APPIMAGE").is_some();
    }
    cfg!(windows)
}

/// DB・バックアップの置き場(tauri-plugin-sql の既定は app_config_dir)
pub(crate) fn db_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    match portable_dir() {
        Some(d) => Ok(d),
        None => app.path().app_config_dir().map_err(|e| e.to_string()),
    }
}

/// 背景画像・Cookie の置き場(既定は app_data_dir。Windows では app_config_dir と同じ場所)
pub(crate) fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    match portable_dir() {
        Some(d) => Ok(d),
        None => app.path().app_data_dir().map_err(|e| e.to_string()),
    }
}

/// フロントの `Database.load()` に渡す接続文字列。migration の登録の鍵でもあるので、JS は db_url コマンドで同じ文字列を受け取る。
/// ポータブルなら絶対パス(tauri-plugin-sql は app_config_dir に push するだけなので、絶対パスを渡せばそこになる)
fn db_url() -> String {
    match portable_dir() {
        Some(d) => format!("sqlite:{}", d.join(DB_FILE).display()),
        None => format!("sqlite:{DB_FILE}"),
    }
}

/// JS に渡す、データの置き場(設定 → このアプリについて の「データの保存場所」と、DB を開く URL)
#[derive(serde::Serialize)]
struct DataPaths {
    db_url: String,
    db: String,
    backups: String,
    portable: bool,
}

#[tauri::command]
fn data_paths(app: tauri::AppHandle) -> Result<DataPaths, String> {
    let dir = db_dir(&app)?;
    Ok(DataPaths {
        db_url: db_url(),
        db: dir.join(DB_FILE).to_string_lossy().into_owned(),
        backups: dir.join("backups").to_string_lossy().into_owned(),
        portable: portable_dir().is_some(),
    })
}

/// 背景画像をアセット(asset:)で読めるようにする。tauri.conf.json の許可は %APPDATA% の中だけなので、ポータブルでは起動時と差し替え時にここで許す
fn allow_background_asset(app: &tauri::AppHandle, path: &Path) {
    if portable_dir().is_some() {
        let _ = app.asset_protocol_scope().allow_file(path);
    }
}

/// 置き場にある背景画像のファイル
fn background_files(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    entries.flatten().filter(|e| e.file_name().to_string_lossy().starts_with("background-")).map(|e| e.path()).collect()
}

/// UNIX 時刻(ファイル名に入れる。取れなければ 0)
fn since_epoch() -> std::time::Duration {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default()
}

/// OS に入っているフォント 1 ファミリーぶん
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemFont {
    /// CSS の font-family に書く名前(英語名)
    family: String,
    /// 日本語の名前があれば(「BIZ UDゴシック」など)
    local_name: Option<String>,
    monospaced: bool,
}

/// OS のフォントをファミリーごとにまとめて返す。WebView からは一覧を取れないので Rust 側で列挙する
#[tauri::command]
async fn list_system_fonts() -> Vec<SystemFont> {
    // フォントファイルを数百読むので、画面を止めないよう別スレッドで
    tauri::async_runtime::spawn_blocking(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        let mut fonts: BTreeMap<String, SystemFont> = BTreeMap::new();
        for face in db.faces() {
            let Some((family, _)) = face.families.first() else { continue };
            let local_name = face
                .families
                .iter()
                .find(|(_, lang)| *lang == fontdb::Language::Japanese_Japan)
                .map(|(name, _)| name.clone());
            let entry = fonts.entry(family.clone()).or_insert_with(|| SystemFont {
                family: family.clone(),
                local_name: None,
                monospaced: false,
            });
            entry.local_name = entry.local_name.take().or(local_name);
            entry.monospaced |= face.monospaced;
        }
        fonts.into_values().collect()
    })
    .await
    .unwrap_or_default()
}

fn migrations() -> Vec<Migration> {
    // SQL は packages/logstore にあり、vitest のテストでも同じファイルを使う
    macro_rules! m {
        ($version:literal, $description:literal, $file:literal) => {
            Migration {
                version: $version,
                description: $description,
                sql: include_str!(concat!("../../../../packages/logstore/migrations/", $file)),
                kind: MigrationKind::Up,
            }
        };
    }
    vec![
        m!(1, "init", "001_init.sql"),
        m!(2, "settings", "002_settings.sql"),
        m!(3, "favorite_boards", "003_favorite_boards.sql"),
        m!(4, "own_posts", "004_own_posts.sql"),
        m!(5, "favicons", "005_favicons.sql"),
        m!(6, "uploads", "006_uploads.sql"),
        m!(7, "upload_account", "007_upload_account.sql"),
        m!(8, "ogp_cache", "008_ogp.sql"),
        m!(9, "post_history", "009_post_history.sql"),
        m!(10, "favorite_threads", "010_favorite_threads.sql"),
        m!(11, "accounts", "011_accounts.sql"),
        m!(12, "drafts", "012_drafts.sql"),
        m!(13, "post_ref", "013_post_ref.sql"),
        m!(14, "troll_marks", "014_troll_marks.sql"),
        m!(15, "post_badges", "015_post_badges.sql"),
        m!(16, "upload_hash", "016_upload_hash.sql"),
        m!(17, "upload_delete_url", "017_upload_delete_url.sql"),
        m!(18, "sync", "018_sync.sql"),
    ]
}

/// http の URL の https 版(http でなければ None)
pub(crate) fn https_of(url: &str) -> Option<String> {
    let rest = url.get(..7).filter(|s| s.eq_ignore_ascii_case("http://")).map(|_| &url[7..])?;
    Some(format!("https://{rest}"))
}

/// 中身の先頭のバイトから、画像・動画の拡張子を決める。画像でも動画でもなければ None
pub(crate) fn media_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("jpg");
    }
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Some("png");
    }
    if bytes.starts_with(b"GIF8") {
        return Some("gif");
    }
    if bytes.starts_with(b"BM") {
        return Some("bmp");
    }
    if bytes.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
        return Some("webm");
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        return Some(match &bytes[8..12] {
            b"avif" | b"avis" => "avif",
            b"heic" | b"heix" | b"mif1" | b"msf1" => "heic",
            b"qt  " => "mov",
            _ => "mp4",
        });
    }
    None
}

pub(crate) use save_name::percent_decode;

/// 同じ名前のファイルがあれば「名前 (1).jpg」のようにずらして、上書きしない。
/// 調べてから作るのでは同時に保存したときにぶつかるので、「ないときだけ作る」で空いている名前を確保する
fn create_unique(dir: &Path, name: &str) -> std::io::Result<(std::fs::File, PathBuf)> {
    let mut n = 0u32;
    loop {
        let path = dir.join(save_name::numbered_name(name, n));
        match std::fs::File::options().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((file, path)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            // Windows では同じ名前のフォルダがあるとこの失敗になる
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied && path.exists() => {}
            Err(e) => return Err(e),
        }
        n += 1;
    }
}

/// 保存先に写す。フォルダとファイル名は書き方(pattern)と変数から作る。動画はキャッシュに残さないので移す(1 GB の枠を長い動画で埋めない)
fn copy_to_save_dir(source: &Path, base: &Path, pattern: &str, vars: &save_name::SaveVars, url: &str, move_it: bool) -> Result<PathBuf, String> {
    let head = media_cache::read_head(source).ok_or("保存するファイルを読めませんでした")?;
    let extension = media_extension(&head).ok_or("画像でも動画でもないので保存しませんでした")?;
    let mut parts = save_name::save_path(pattern, url, extension, vars);
    let name = parts.pop().unwrap_or_default();
    let dir = parts.iter().fold(base.to_path_buf(), |d, p| d.join(p));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let (mut out, path) = create_unique(&dir, &name).map_err(|e| e.to_string())?;
    let copied = std::fs::File::open(source).and_then(|mut input| std::io::copy(&mut input, &mut out));
    drop(out);
    if let Err(e) = copied {
        let _ = std::fs::remove_file(&path);
        return Err(e.to_string());
    }
    if move_it || media_cache::is_video(&head) {
        let _ = std::fs::remove_file(source);
    }
    Ok(path)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedImage {
    path: String,
    /// 通信せず、キャッシュから写した
    from_cache: bool,
}

/// 画像を保存し、保存したファイルのパスを返す。dir が空ならダウンロードフォルダ。その下のフォルダとファイル名は
/// pattern(例 `{site}/{board}/{filename}`。空なら元のファイル名)と、画面から渡す板・スレ・時刻の値で決める。キャッシュにあれば通信しない
#[tauri::command]
async fn save_image(
    app: tauri::AppHandle,
    cache: tauri::State<'_, Arc<MediaCache>>,
    url: String,
    dir: String,
    pattern: Option<String>,
    vars: Option<save_name::SaveVars>,
) -> Result<SavedImage, String> {
    let pattern = pattern.unwrap_or_default();
    let vars = vars.unwrap_or_default();
    let dir = if dir.trim().is_empty() {
        app.path().download_dir().map_err(|e| e.to_string())?
    } else {
        PathBuf::from(dir)
    };
    let cache = cache.inner().clone();
    // 自動で読まないアドレスは、押して読むことにしたものだけがここへ来る。キャッシュには置かない
    let (source, from_cache, temporary) = if cache.is_allowed(&url) {
        let (path, hit) = cache.ensure(&url, true).await?;
        (path, hit, false)
    } else {
        (cache.fetch_uncached(&url).await?, false, true)
    };
    let saved = tauri::async_runtime::spawn_blocking(move || copy_to_save_dir(&source, &dir, &pattern, &vars, &url, temporary))
        .await
        .map_err(|e| e.to_string())??;
    Ok(SavedImage { path: saved.to_string_lossy().into_owned(), from_cache })
}

/// 設定の見本: 書き方と見本の値から、土台のフォルダの下の場所を作る(ファイルは作らない)
#[tauri::command]
fn save_path_preview(pattern: String, url: String, ext: String, vars: save_name::SaveVars) -> Vec<String> {
    save_name::save_path(&pattern, &url, &ext, &vars)
}

/// 背景画像を、アプリのデータフォルダにコピーしてそのパスを返す。
/// 画面からはアセット(このフォルダの中だけ読める)で読むので、元のファイルを動かしても表示が崩れない。
/// 名前に時刻を入れて、画像を替えたときに古いものが表示に残らないようにし、前のコピーは消す
#[tauri::command]
fn set_background_image(app: tauri::AppHandle, chosen: tauri::State<'_, ChosenPaths>, source: String) -> Result<String, String> {
    let source = chosen.take(&source)?;
    let dir = data_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    for path in background_files(&dir) {
        let _ = std::fs::remove_file(path);
    }
    let ext = Path::new(&source)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| "png".into());
    let stamp = since_epoch().as_millis();
    let dest = dir.join(format!("background-{stamp}.{ext}"));
    std::fs::copy(&source, &dest).map_err(|e| e.to_string())?;
    allow_background_asset(&app, &dest);
    Ok(dest.to_string_lossy().into_owned())
}

/// 設定に残っているパスから、背景画像のファイル名を取り出す(Windows のパスも Linux のパスも読む)。背景画像でなければ None
fn background_file_name(saved: &str) -> Option<&str> {
    saved.rsplit(['/', '\\']).next().filter(|name| name.starts_with("background-"))
}

/// 設定に残っているパスを、いまの置き場のものに読み替える(identifier の変更やポータブル版のフォルダの移動で読めなくなるため)。
/// 見るのはファイル名だけなので、置き場の外のファイルは読めない。Linux の旧置き場は DB と別の場所で migrate_old_data_dir が写さないので、ここで写す
#[tauri::command]
fn current_background_image(app: tauri::AppHandle, saved: String) -> Result<String, String> {
    let Some(name) = background_file_name(&saved) else { return Ok(saved) };
    let dir = data_dir(&app)?;
    let dest = dir.join(name);
    if !dest.is_file() && portable_dir().is_none() {
        if let Some(old) = dir.parent().map(|p| p.join(OLD_IDENTIFIER).join(name)).filter(|p| p.is_file()) {
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            std::fs::copy(&old, &dest).map_err(|e| e.to_string())?;
        }
    }
    if !dest.is_file() {
        return Ok(saved);
    }
    allow_background_asset(&app, &dest);
    Ok(dest.to_string_lossy().into_owned())
}

// ── バックアップ ──

/// DB のファイル名(db_url() の sqlite: の後ろ)。置き場は db_dir()
const DB_FILE: &str = "bbs-browser.db";
/// 復元を頼まれた DB の置き場。次に起動したとき、DB を開く前に入れ替える
const RESTORE_FILE: &str = "restore-pending.db";

fn has_extension(path: &Path, exts: &[&str]) -> bool {
    path.extension()
        .map(|e| exts.iter().any(|x| e.eq_ignore_ascii_case(x)))
        .unwrap_or(false)
}

/// 設定や NG の書き出し。ダイアログで選んだ場所に書く(.json だけ)
#[tauri::command]
fn write_json_file(chosen: tauri::State<'_, ChosenPaths>, path: String, contents: String) -> Result<(), String> {
    let path = chosen.take(&path)?;
    if !has_extension(&path, &["json"]) {
        return Err("書き出せるのは .json だけです".into());
    }
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

/// スレの書き出し。ダイアログで選んだ場所に書く(.html と .txt だけ)
#[tauri::command]
fn write_text_file(chosen: tauri::State<'_, ChosenPaths>, path: String, contents: String) -> Result<(), String> {
    let path = chosen.take(&path)?;
    if !has_extension(&path, &["html", "htm", "txt"]) {
        return Err("書き出せるのは .html か .txt だけです".into());
    }
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

/// 設定や NG の読み込み(.json だけ、20MB まで)
#[tauri::command]
fn read_json_file(chosen: tauri::State<'_, ChosenPaths>, path: String) -> Result<String, String> {
    let path = chosen.take(&path)?;
    if !has_extension(&path, &["json"]) {
        return Err("読み込めるのは .json だけです".into());
    }
    let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > 20 * 1024 * 1024 {
        return Err("ファイルが大きすぎます".into());
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// DB 全体をダイアログで選んだ先へ書き出す(SQLite の VACUUM INTO。使っている最中でも壊れない写しになる)。
/// VACUUM INTO は書き出し先が既にあると失敗するので、上書きを選んだときは先に消す(.db だけ)。
/// 画面の SQL の口は VACUUM を断るので、書き出しはここでだけ行う
#[tauri::command]
async fn backup_db(app: tauri::AppHandle, chosen: tauri::State<'_, ChosenPaths>, path: String) -> Result<(), String> {
    let path = chosen.take(&path)?;
    if !has_extension(&path, &["db", "sqlite", "sqlite3"]) {
        return Err("バックアップの名前は .db で終わるようにしてください".into());
    }
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    let target = path.to_string_lossy().into_owned();
    sql_batch::with_pool(&app, async |pool| {
        sqlx::query("VACUUM INTO $1").bind(target).execute(pool).await.map(|_| ()).map_err(|e| e.to_string())
    })
    .await
}

/// DB の復元を頼む。選んだファイルが SQLite かを確かめてから置き場にコピーし、アプリを起動し直す
/// (開いている DB はその場では入れ替えられないため、次の起動のはじめに入れ替える)
#[tauri::command]
fn schedule_db_restore(app: tauri::AppHandle, chosen: tauri::State<'_, ChosenPaths>, source: String) -> Result<(), String> {
    let source = chosen.take(&source)?;
    let mut head = [0u8; 16];
    {
        use std::io::Read;
        let mut f = std::fs::File::open(&source).map_err(|e| e.to_string())?;
        f.read_exact(&mut head).map_err(|_| "SQLite のファイルではありません".to_string())?;
    }
    if &head != b"SQLite format 3\0" {
        return Err("SQLite のファイルではありません".into());
    }
    let dir = db_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::copy(&source, dir.join(RESTORE_FILE)).map_err(|e| e.to_string())?;
    app.restart();
}

/// 復元を頼まれていたら、DB を開く前に入れ替える。
/// いまの DB は消さずに「bbs-browser.before-restore-時刻.db」として残す(-wal / -shm も一緒に)
fn apply_pending_restore(app: &tauri::AppHandle) {
    let Ok(dir) = db_dir(app) else { return };
    let pending = dir.join(RESTORE_FILE);
    if !pending.exists() {
        return;
    }
    let stamp = since_epoch().as_secs();
    for suffix in ["", "-wal", "-shm"] {
        let current = dir.join(format!("{DB_FILE}{suffix}"));
        if current.exists() {
            let _ = std::fs::rename(&current, dir.join(format!("bbs-browser.before-restore-{stamp}.db{suffix}")));
        }
    }
    let _ = std::fs::rename(&pending, dir.join(DB_FILE));
}

/// DB の形(migration の数)を覚えておくファイル。前の起動と違えば、DB を開く前に写しを取る
const SCHEMA_MARK: &str = "db-schema-version.txt";
/// 形が変わる前の写しを残す数
const KEEP_SCHEMA_BACKUPS: usize = 3;
const SCHEMA_BACKUP_PREFIX: &str = "bbs-browser.before-schema-";

/// DB の形を変える版(migration を足した版)を初めて起動したとき、DB を開く前に写しを取る。
/// 写しは設定フォルダの backups/ に「bbs-browser.before-schema-<新しい形>-<時刻>.db」(と -wal)で置き、新しいものから 3 つ残す。
/// migration が途中で失敗して DB が壊れても、ここから戻せるようにするため
fn backup_before_migrations(app: &tauri::AppHandle) {
    let Ok(dir) = db_dir(app) else { return };
    let current = migrations().len().to_string();
    let mark = dir.join(SCHEMA_MARK);
    if std::fs::read_to_string(&mark).unwrap_or_default().trim() == current {
        return;
    }
    if dir.join(DB_FILE).exists() {
        let backups = dir.join("backups");
        if std::fs::create_dir_all(&backups).is_err() {
            return;
        }
        let stamp = since_epoch().as_secs();
        let name = format!("{SCHEMA_BACKUP_PREFIX}{current}-{stamp}.db");
        for suffix in ["", "-wal"] {
            let from = dir.join(format!("{DB_FILE}{suffix}"));
            // 写しが取れなければ、印を書かずに終わる(次の起動でまた取り直す)
            if from.exists() && std::fs::copy(&from, backups.join(format!("{name}{suffix}"))).is_err() {
                return;
            }
        }
        prune_schema_backups(&backups);
    }
    let _ = std::fs::write(&mark, current);
}

/// 形が変わる前の写しを、新しいもの(名前の最後の時刻が大きいもの)から KEEP_SCHEMA_BACKUPS 個だけ残す
fn prune_schema_backups(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut found: Vec<(u64, PathBuf)> = entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let stem = name.strip_prefix(SCHEMA_BACKUP_PREFIX)?.strip_suffix(".db")?;
            let stamp = stem.rsplit('-').next()?.parse::<u64>().ok()?;
            Some((stamp, e.path()))
        })
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in found.into_iter().skip(KEEP_SCHEMA_BACKUPS) {
        let mut wal = path.clone().into_os_string();
        wal.push("-wal");
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(PathBuf::from(wal));
    }
}

/// WebView2 の「ブラウザのショートカット」(F5・Ctrl+R の読み直し、Ctrl+F の検索窓、Ctrl+P の印刷など)を切る。
/// F5 で画面ごと読み直すと、開いていたものが消え、連打でサーバーにも負担がかかる。
/// ページ側で keydown を止めても効かないことがあるので、WebView2 の設定で切る(F5 はアプリがスレの更新に使う)
#[cfg(windows)]
fn disable_browser_accelerator_keys(app: &tauri::App) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows_core::Interface;
    let Some(window) = app.get_webview_window("main") else { return };
    let _ = window.with_webview(|webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        let Ok(settings) = core.Settings() else { return };
        if let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() {
            let _ = settings3.SetAreBrowserAcceleratorKeysEnabled(false);
        }
    });
}

/// Linux: 描画のプロセス(WebKitWebProcess)が落ちると画面が固まったままになるので、記録して読み直す。
/// 同じ所ですぐまた落ちるときは読み直しを繰り返さない(1 分に 3 回まで)
#[cfg(target_os = "linux")]
fn reload_when_web_process_dies(app: &tauri::App) {
    use webkit2gtk::WebViewExt;
    let Some(window) = app.get_webview_window("main") else { return };
    let _ = window.with_webview(|webview| {
        let recent = std::cell::RefCell::new(Vec::<std::time::Instant>::new());
        webview.inner().connect_web_process_terminated(move |view, reason| {
            eprintln!("描画のプロセスが終了しました: {reason:?}");
            let mut recent = recent.borrow_mut();
            recent.retain(|at| at.elapsed() < std::time::Duration::from_secs(60));
            if recent.len() < 3 {
                recent.push(std::time::Instant::now());
                view.reload();
            }
        });
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut context = tauri::generate_context!();
    // ZIP 版: app_*_dir をすべて data\ にする。WebView2 のデータ(localStorage など。どの窓も既定は app_local_data_dir)と
    // plugin-http の Cookie(app_cache_dir。置き場を指定できない)が %LOCALAPPDATA% に残らないように
    if let Some(dir) = portable_dir() {
        context.config_mut().app.app_directories_override = Some(tauri::utils::config::AppDirectoriesOverride::Root(dir));
    }
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol(media_cache::SCHEME, media_cache::handle_protocol)
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(&db_url(), migrations())
                .build(),
        )
        // DB を開くのは画面(JS)が動き出してからなので、ここで入れ替えれば間に合う
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            migrate_old_data_dir(app.handle());
            apply_pending_restore(app.handle());
            #[cfg(desktop)]
            window_state::setup(app.handle());
            // 主の窓を閉じたら、設定・NG の一覧などの道具の窓も一緒に閉じてアプリを終える(道具の窓だけ残らないように)
            if let Some(main) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                main.on_window_event(move |event| {
                    if let tauri::WindowEvent::Destroyed = event {
                        handle.exit(0);
                    }
                });
            }
            backup_before_migrations(app.handle());
            app.manage(post_http::PostCookies::load(app.handle()));
            app.manage(ChosenPaths::default());
            app.manage(fonts::FontJobs::default());
            // フォルダは最初に保存するときに作る(起動時に読み書きしない)
            let media_cache = MediaCache::new(data_dir(app.handle())?.join("media-cache"), media_cache::is_auto_loadable)?;
            app.manage(Arc::new(media_cache));
            fonts::prepare(app.handle());
            // ポータブルでは、前に置いた背景画像もアセットで読めるように許す
            if portable_dir().is_some() {
                if let Ok(dir) = data_dir(app.handle()) {
                    for path in background_files(&dir) {
                        allow_background_asset(app.handle(), &path);
                    }
                }
            }
            #[cfg(target_os = "linux")]
            reload_when_web_process_dies(app);
            #[cfg(windows)]
            disable_browser_accelerator_keys(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            can_self_update,
            data_paths,
            list_system_fonts,
            fonts::font_status,
            fonts::font_css,
            fonts::download_font,
            fonts::cancel_font_download,
            save_image,
            save_path_preview,
            media_cache::media_cached,
            media_cache::cancel_media,
            media_cache::media_cache_usage,
            media_cache::media_cache_clear,
            set_background_image,
            current_background_image,
            write_json_file,
            write_text_file,
            read_json_file,
            backup_db,
            schedule_db_restore,
            post_http::http_post,
            sql_batch::sql_batch,
            sql_batch::sql_execute,
            sql_batch::sql_select,
            sync_http::sync_http,
            google_auth::google_available,
            google_auth::google_account,
            google_auth::google_login,
            google_auth::google_access_token,
            google_auth::google_login_cancel,
            google_auth::google_pairing_token,
            google_auth::google_adopt,
            google_auth::google_forget,
            google_auth::google_revoke,
            sync_key::sync_key_load,
            sync_key::sync_key_save,
            sync_key::sync_key_clear,
            sync_start::open_sync_start,
            sync_start::close_sync_start,
            chosen_paths::pick_save_path,
            chosen_paths::pick_open_path,
            web_upload::open_web_upload,
            web_upload::close_web_upload
        ])
        .run(context)
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_keep_data_when_the_sync_tables_are_added() {
        tauri::async_runtime::block_on(async {
            let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
            let all = migrations();
            let (old, new): (Vec<_>, Vec<_>) = all.into_iter().partition(|m| m.version <= 17);
            for m in old {
                sqlx::raw_sql(m.sql).execute(&pool).await.unwrap();
            }
            sqlx::query("INSERT INTO favorite_threads (board_url, key, connector_id, title, sort, added_at) VALUES ('https://a.test/b/', '1', '2ch-compat', 't', 1, 2)")
                .execute(&pool).await.unwrap();
            for m in new {
                sqlx::raw_sql(m.sql).execute(&pool).await.unwrap();
            }
            let (n,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM favorite_threads").fetch_one(&pool).await.unwrap();
            assert_eq!(n, 1);
            let (n,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM sync_records").fetch_one(&pool).await.unwrap();
            assert_eq!(n, 0);
        });
    }

    #[test]
    fn saving_at_the_same_time_never_overwrites() {
        let dir = std::env::temp_dir().join(format!("obb-save-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let threads: Vec<_> = (0..32)
            .map(|i| {
                let dir = dir.clone();
                std::thread::spawn(move || {
                    use std::io::Write;
                    let (mut file, path) = create_unique(&dir, "x.png").unwrap();
                    file.write_all(format!("{i}").as_bytes()).unwrap();
                    path
                })
            })
            .collect();
        let mut paths: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
        paths.sort();
        paths.dedup();
        assert_eq!(paths.len(), 32);
        assert!(dir.join("x.png").exists());
        assert!(dir.join("x (31).png").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn background_name_is_taken_from_any_path() {
        assert_eq!(background_file_name(r"C:\Users\a\AppData\Roaming\old\background-1.png"), Some("background-1.png"));
        assert_eq!(background_file_name("/home/a/.local/share/old/background-1.png"), Some("background-1.png"));
        assert_eq!(background_file_name("/home/a/picture.png"), None);
        assert_eq!(background_file_name(""), None);
    }

    #[test]
    fn only_http_is_upgraded() {
        assert_eq!(https_of("http://a.test/x.png").as_deref(), Some("https://a.test/x.png"));
        assert_eq!(https_of("HTTP://a.test/").as_deref(), Some("https://a.test/"));
        assert_eq!(https_of("https://a.test/"), None);
        assert_eq!(https_of("ftp://a.test/"), None);
    }

    #[test]
    fn only_media_is_recognized() {
        assert_eq!(media_extension(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("jpg"));
        assert_eq!(media_extension(b"MZ\x90\x00"), None);
        assert_eq!(media_extension(b"<html>"), None);
    }
}

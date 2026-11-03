use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use tauri::Manager;

use tauri_plugin_sql::{Migration, MigrationKind};

mod chosen_paths;
mod post_http;
mod update;
mod web_upload;

use chosen_paths::ChosenPaths;

// ── データの置き場 ──
//
// ふつう(インストーラー版)は OS の決まりの場所(%APPDATA%\<identifier>\)。
// ZIP 版は「展開したフォルダがインストール先」: exe と同じフォルダに portable.txt か data フォルダがあれば、
// DB・設定・Cookie・背景画像をそのフォルダの data\ に置く(フォルダごと消せばまっさら、別の場所に展開すれば別のデータ)。
// 置き場を決めるのはここだけ。ほかの所は app_data_dir()/app_config_dir() を直に呼ばず、data_dir()/db_dir() を使う

/// ZIP 版(ポータブル)のデータフォルダ。exe の隣に portable.txt か data\ があればそこ(なければ None)
fn portable_dir() -> Option<PathBuf> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let data = exe_dir.join("data");
    if data.is_dir() || exe_dir.join("portable.txt").is_file() {
        let _ = std::fs::create_dir_all(&data);
        Some(data)
    } else {
        None
    }
}

/// DB・バックアップの置き場(tauri-plugin-sql の既定は app_config_dir)
fn db_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
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
    vec![
        Migration {
            version: 1,
            description: "init",
            sql: include_str!("../../../../packages/logstore/migrations/001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "settings",
            sql: include_str!("../../../../packages/logstore/migrations/002_settings.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "favorite_boards",
            sql: include_str!("../../../../packages/logstore/migrations/003_favorite_boards.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "own_posts",
            sql: include_str!("../../../../packages/logstore/migrations/004_own_posts.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "favicons",
            sql: include_str!("../../../../packages/logstore/migrations/005_favicons.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "uploads",
            sql: include_str!("../../../../packages/logstore/migrations/006_uploads.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "upload_account",
            sql: include_str!("../../../../packages/logstore/migrations/007_upload_account.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "ogp_cache",
            sql: include_str!("../../../../packages/logstore/migrations/008_ogp.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "post_history",
            sql: include_str!("../../../../packages/logstore/migrations/009_post_history.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "favorite_threads",
            sql: include_str!("../../../../packages/logstore/migrations/010_favorite_threads.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "accounts",
            sql: include_str!("../../../../packages/logstore/migrations/011_accounts.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "drafts",
            sql: include_str!("../../../../packages/logstore/migrations/012_drafts.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "post_ref",
            sql: include_str!("../../../../packages/logstore/migrations/013_post_ref.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "troll_marks",
            sql: include_str!("../../../../packages/logstore/migrations/014_troll_marks.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "post_badges",
            sql: include_str!("../../../../packages/logstore/migrations/015_post_badges.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "upload_hash",
            sql: include_str!("../../../../packages/logstore/migrations/016_upload_hash.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

/// URL の最後の部分からファイル名を作る。Windows で使えない文字は _ にする
fn file_name_from_url(url: &str) -> String {
    let path = url.split(['?', '#']).next().unwrap_or(url);
    let last = path.rsplit('/').find(|s| !s.is_empty()).unwrap_or("image");
    let cleaned: String = last
        .chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) || c.is_control() { '_' } else { c })
        .collect();
    if cleaned.is_empty() { "image".into() } else { cleaned }
}

/// 同じ名前のファイルがあれば「名前 (1).jpg」のようにずらして、上書きしない
fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    (1..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .expect("空いている名前は必ず見つかる")
}

/// 画像を取得して保存し、保存したファイルのパスを返す。dir が空ならダウンロードフォルダ
#[tauri::command]
async fn save_image(app: tauri::AppHandle, url: String, dir: String) -> Result<String, String> {
    let dir = if dir.trim().is_empty() {
        app.path().download_dir().map_err(|e| e.to_string())?
    } else {
        PathBuf::from(dir)
    };
    let client = tauri_plugin_http::reqwest::Client::builder()
        .user_agent("Monazilla/1.00 (bbs-browser/0.1.0)")
        .build()
        .map_err(|e| e.to_string())?;
    let bytes = client
        .get(&url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = unique_path(&dir, &file_name_from_url(&url));
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// 背景画像を、アプリのデータフォルダにコピーしてそのパスを返す。
/// 画面からはアセット(このフォルダの中だけ読める)で読むので、元のファイルを動かしても表示が崩れない。
/// 名前に時刻を入れて、画像を替えたときに古いものが表示に残らないようにし、前のコピーは消す
#[tauri::command]
fn set_background_image(app: tauri::AppHandle, chosen: tauri::State<'_, ChosenPaths>, source: String) -> Result<String, String> {
    let source = chosen.take(&source)?;
    let dir = data_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().starts_with("background-") {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    let ext = Path::new(&source)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| "png".into());
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    let dest = dir.join(format!("background-{stamp}.{ext}"));
    std::fs::copy(&source, &dest).map_err(|e| e.to_string())?;
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

/// DB のバックアップ先を空ける。SQLite の VACUUM INTO は書き出し先が既にあると失敗するので、
/// ダイアログで上書きを選んだときは先に消す(.db だけ)
#[tauri::command]
fn prepare_db_backup(chosen: tauri::State<'_, ChosenPaths>, path: String) -> Result<(), String> {
    let path = chosen.take(&path)?;
    if !has_extension(&path, &["db", "sqlite", "sqlite3"]) {
        return Err("バックアップの名前は .db で終わるようにしてください".into());
    }
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
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
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default();
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
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or_default();
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            apply_pending_restore(app.handle());
            backup_before_migrations(app.handle());
            app.manage(post_http::PostCookies::load(app.handle()));
            app.manage(ChosenPaths::default());
            // ポータブルでは、前に置いた背景画像もアセットで読めるように許す
            if let Ok(dir) = data_dir(app.handle()) {
                if let Ok(entries) = std::fs::read_dir(&dir) {
                    for entry in entries.flatten() {
                        if entry.file_name().to_string_lossy().starts_with("background-") {
                            allow_background_asset(app.handle(), &entry.path());
                        }
                    }
                }
            }
            #[cfg(windows)]
            disable_browser_accelerator_keys(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            data_paths,
            list_system_fonts,
            save_image,
            set_background_image,
            write_json_file,
            write_text_file,
            read_json_file,
            prepare_db_backup,
            schedule_db_restore,
            post_http::http_post,
            chosen_paths::pick_save_path,
            chosen_paths::pick_open_path,
            web_upload::open_web_upload,
            web_upload::show_web_upload,
            web_upload::close_web_upload,
            update::download_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use tauri::Manager;

use tauri_plugin_sql::{Migration, MigrationKind};

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

/// フロントの `Database.load()` に渡す接続文字列。DB は %APPDATA%\<identifier>\ に置かれる
const DB_URL: &str = "sqlite:bbs-browser.db";

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
fn set_background_image(app: tauri::AppHandle, source: String) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
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
    Ok(dest.to_string_lossy().into_owned())
}

// ── バックアップ ──

/// DB のファイル名(DB_URL の sqlite: の後ろ)。tauri-plugin-sql はアプリの設定フォルダに置く
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
fn write_json_file(path: String, contents: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !has_extension(&path, &["json"]) {
        return Err("書き出せるのは .json だけです".into());
    }
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

/// 設定や NG の読み込み(.json だけ、20MB まで)
#[tauri::command]
fn read_json_file(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
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
fn prepare_db_backup(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
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
fn schedule_db_restore(app: tauri::AppHandle, source: String) -> Result<(), String> {
    let mut head = [0u8; 16];
    {
        use std::io::Read;
        let mut f = std::fs::File::open(&source).map_err(|e| e.to_string())?;
        f.read_exact(&mut head).map_err(|_| "SQLite のファイルではありません".to_string())?;
    }
    if &head != b"SQLite format 3\0" {
        return Err("SQLite のファイルではありません".into());
    }
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::copy(&source, dir.join(RESTORE_FILE)).map_err(|e| e.to_string())?;
    app.restart();
}

/// 復元を頼まれていたら、DB を開く前に入れ替える。
/// いまの DB は消さずに「bbs-browser.before-restore-時刻.db」として残す(-wal / -shm も一緒に)
fn apply_pending_restore(app: &tauri::AppHandle) {
    let Ok(dir) = app.path().app_config_dir() else { return };
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        // DB を開くのは画面(JS)が動き出してからなので、ここで入れ替えれば間に合う
        .setup(|app| {
            apply_pending_restore(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_system_fonts,
            save_image,
            set_background_image,
            write_json_file,
            read_json_file,
            prepare_db_backup,
            schedule_db_restore
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

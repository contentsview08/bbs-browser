//! ChMate(Android の専ブラ)のバックアップ(ZIP)を読む。中身の意味づけは画面側(utils/chmate.ts)で行い、
//! ここは ZIP をほどいて文字にする・SQLite の表を読むだけ。
//!
//! ZIP の中身(2026-11 の ChMate で確かめた形):
//! - `dat/<板>_<キー>.dat`: スレのログ(Shift_JIS の dat。板は `host%2Fboard` か、5ch の板ならディレクトリ名だけ)
//! - `dat/<板>_<キー>.idx`: 1 行目 `最終更新(ms)\tETag`、2 行目 自分の書き込みのレス番号 `no:1,no:1,…`
//! - `archive/<板>/<スレタイ>/<板>_<キー>.dat|.idx`: 保存したスレ(dat と同じ形)
//! - `databases/roidon.sqlite`: `bookmarks`(お気に入りのスレ。read_state の JSON の r が既読の番号)、`boards`(板一覧。ディレクトリ名 → サーバー)
//! - `ng/_id.json` `_word.json` `_name.json` `_title.json` `_be.json`: NG(`w` 言葉、`f` 旗(32 なら正規表現)、`ct` 作った時刻、`b` 板)
//! - `files/postDataList.json`: 書き込みの履歴、`files/keyword_group_list.json`: スレタイのキーワード
//! - `prefs/*.xml`: アプリの設定(画面の好みなので読まない)
//!
//! 選んだファイルだけを読む(chosen_paths)。ZIP の中の名前は使わず、書き出すのは SQLite を一時ファイルに写すときだけ(アプリのキャッシュの中)

use std::collections::HashMap;
use std::io::Read;

use serde::Serialize;
use sqlx::Row;
use tauri::Manager;

use crate::chosen_paths::ChosenPaths;

/// ZIP 全体の大きさの上限(ログが多いと数百 MB になるが、それ以上は読まない)
const MAX_ZIP_BYTES: u64 = 1024 * 1024 * 1024;
/// 1 つのファイルの上限(dat は 1000 レスでも数 MB)
const MAX_ENTRY_BYTES: u64 = 64 * 1024 * 1024;
/// 読む dat の数の上限
const MAX_DATS: usize = 20000;

#[derive(Serialize)]
pub struct ChmateDat {
    /// ファイル名(フォルダなし。`host%2Fboard_1234567890.dat`)
    pub name: String,
    /// Shift_JIS から直した本文
    pub text: String,
    /// 同じ名前の .idx の中身(あれば)
    pub idx: Option<String>,
}

#[derive(Serialize)]
pub struct ChmateBookmark {
    pub name: String,
    pub created: i64,
    pub title: String,
    pub res_count: i64,
    pub read_count: i64,
    pub read_state: String,
    pub access: i64,
    pub posted: i64,
}

#[derive(Serialize)]
pub struct ChmateBoard {
    pub name: String,
    pub server: String,
    pub title: String,
}

#[derive(Serialize, Default)]
pub struct ChmateRaw {
    /// `ng/_id.json` などの文字のファイル(名前 → 中身)
    pub texts: HashMap<String, String>,
    pub dats: Vec<ChmateDat>,
    pub bookmarks: Vec<ChmateBookmark>,
    pub boards: Vec<ChmateBoard>,
    /// 読めなかったもの・読まなかったものの理由(画面に出す)
    pub skipped: Vec<String>,
}

fn base_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// 文字のファイルとして読む対象か(NG・書き込み履歴・キーワード)
fn is_text_entry(name: &str) -> bool {
    (name.starts_with("ng/") || name.starts_with("files/")) && name.ends_with(".json")
}

fn read_entry(entry: &mut zip::read::ZipFile<'_, std::fs::File>) -> Result<Vec<u8>, String> {
    let mut buf = Vec::with_capacity(entry.size().min(MAX_ENTRY_BYTES) as usize);
    entry.take(MAX_ENTRY_BYTES).read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}

/// ChMate のバックアップ(ZIP)をほどく。選んだファイルだけ(.zip)
#[tauri::command]
pub async fn read_chmate_backup(app: tauri::AppHandle, chosen: tauri::State<'_, ChosenPaths>, path: String) -> Result<ChmateRaw, String> {
    let path = chosen.take(&path)?;
    if !path.extension().map(|e| e.eq_ignore_ascii_case("zip")).unwrap_or(false) {
        return Err("読み込めるのは .zip だけです".into());
    }
    let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > MAX_ZIP_BYTES {
        return Err("ファイルが大きすぎます(1GB まで)".into());
    }
    let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|_| "ZIP として読めません".to_string())?;

    let mut out = ChmateRaw::default();
    let mut dats: HashMap<String, String> = HashMap::new();
    let mut idxs: HashMap<String, String> = HashMap::new();
    let mut sqlite: Option<Vec<u8>> = None;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().map_err(|e| e.to_string())?.replace('\\', "/");
        if entry.size() > MAX_ENTRY_BYTES {
            out.skipped.push(format!("{name}: 大きすぎるので読みません"));
            continue;
        }
        let base = base_name(&name).to_string();
        let in_logs = name.starts_with("dat/") || name.starts_with("archive/");
        if in_logs && base.ends_with(".dat") {
            if dats.len() >= MAX_DATS {
                out.skipped.push(format!("{name}: ログが多すぎるので読みません"));
                continue;
            }
            let bytes = read_entry(&mut entry)?;
            // ChMate は掲示板の文字コードにかかわらず Shift_JIS で保存する
            let (text, _, _) = encoding_rs::SHIFT_JIS.decode(&bytes);
            dats.insert(base, text.into_owned());
        } else if in_logs && base.ends_with(".idx") {
            let bytes = read_entry(&mut entry)?;
            idxs.insert(base, String::from_utf8_lossy(&bytes).into_owned());
        } else if is_text_entry(&name) {
            let bytes = read_entry(&mut entry)?;
            out.texts.insert(name, String::from_utf8_lossy(&bytes).into_owned());
        } else if name.ends_with("databases/roidon.sqlite") {
            sqlite = Some(read_entry(&mut entry)?);
        }
    }
    for (name, text) in dats {
        let idx = idxs.remove(&format!("{}.idx", &name[..name.len() - 4]));
        out.dats.push(ChmateDat { name, text, idx });
    }
    out.dats.sort_by(|a, b| a.name.cmp(&b.name));

    match sqlite {
        Some(bytes) => read_sqlite(&app, &bytes, &mut out).await?,
        None => out.skipped.push("databases/roidon.sqlite がないので、お気に入りのスレは読めません".into()),
    }
    Ok(out)
}

/// SQLite をキャッシュの中の一時ファイルに写して、お気に入りのスレと板一覧を読む(読み終えたら消す)
async fn read_sqlite(app: &tauri::AppHandle, bytes: &[u8], out: &mut ChmateRaw) -> Result<(), String> {
    if !bytes.starts_with(b"SQLite format 3\0") {
        out.skipped.push("roidon.sqlite が SQLite のファイルではありません".into());
        return Ok(());
    }
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("chmate-import.sqlite");
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    let result = read_sqlite_tables(&tmp, out).await;
    let _ = std::fs::remove_file(&tmp);
    result
}

async fn read_sqlite_tables(path: &std::path::Path, out: &mut ChmateRaw) -> Result<(), String> {
    let opts = sqlx::sqlite::SqliteConnectOptions::new().filename(path).read_only(true);
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await
        .map_err(|e| format!("roidon.sqlite を開けません: {e}"))?;
    let rows = sqlx::query("SELECT name, created, title, res_count, read_count, read_state, access, posted FROM bookmarks")
        .fetch_all(&pool)
        .await;
    match rows {
        Ok(rows) => {
            for r in rows {
                out.bookmarks.push(ChmateBookmark {
                    name: r.try_get::<String, _>(0).unwrap_or_default(),
                    created: r.try_get::<i64, _>(1).unwrap_or_default(),
                    title: r.try_get::<String, _>(2).unwrap_or_default(),
                    res_count: r.try_get::<i64, _>(3).unwrap_or_default(),
                    read_count: r.try_get::<i64, _>(4).unwrap_or_default(),
                    read_state: r.try_get::<String, _>(5).unwrap_or_default(),
                    access: r.try_get::<i64, _>(6).unwrap_or_default(),
                    posted: r.try_get::<i64, _>(7).unwrap_or_default(),
                });
            }
        }
        Err(e) => out.skipped.push(format!("お気に入りのスレ(bookmarks)を読めません: {e}")),
    }
    let rows = sqlx::query("SELECT name, server, title FROM boards").fetch_all(&pool).await;
    match rows {
        Ok(rows) => {
            for r in rows {
                out.boards.push(ChmateBoard {
                    name: r.try_get::<String, _>(0).unwrap_or_default(),
                    server: r.try_get::<String, _>(1).unwrap_or_default(),
                    title: r.try_get::<String, _>(2).unwrap_or_default(),
                });
            }
        }
        Err(e) => out.skipped.push(format!("板一覧(boards)を読めません: {e}")),
    }
    pool.close().await;
    Ok(())
}

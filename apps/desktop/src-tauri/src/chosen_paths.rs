//! 保存・読み込みの画面(ダイアログ)で本人が選んだパスだけを、ファイルの読み書きに使わせる。
//!
//! ダイアログは Rust 側で出し、選ばれたパスを覚えておく。ファイルを書く・読む・消す命令は、
//! 覚えたパスでなければ断る(画面側から好きなパスを渡されても、読み書きや削除をしないように)。
//! 覚えたパスは一度使ったら忘れる。

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct ChosenPaths(Mutex<HashSet<PathBuf>>);

impl ChosenPaths {
    fn remember(&self, path: PathBuf) {
        if let Ok(mut set) = self.0.lock() {
            set.insert(path);
        }
    }

    /// 選ばれたパスなら返して忘れる。選ばれていなければ断る
    pub fn take(&self, path: &str) -> Result<PathBuf, String> {
        let path = PathBuf::from(path);
        let mut set = self.0.lock().map_err(|e| e.to_string())?;
        if set.remove(&path) {
            Ok(path)
        } else {
            Err("保存・読み込みの画面で選んだ場所ではありません".into())
        }
    }
}

/// 保存先を選ぶ画面を出す。選ばなければ None
#[tauri::command]
pub async fn pick_save_path(
    app: tauri::AppHandle,
    state: tauri::State<'_, ChosenPaths>,
    default_name: String,
    filter_name: String,
    extensions: Vec<String>,
) -> Result<Option<String>, String> {
    let exts: Vec<&str> = extensions.iter().map(String::as_str).collect();
    let picked = app.dialog().file().set_file_name(default_name).add_filter(filter_name, &exts).blocking_save_file();
    let Some(path) = picked else { return Ok(None) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    state.remember(path.clone());
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// 読み込むファイルを選ぶ画面を出す。選ばなければ None
#[tauri::command]
pub async fn pick_open_path(
    app: tauri::AppHandle,
    state: tauri::State<'_, ChosenPaths>,
    filter_name: String,
    extensions: Vec<String>,
) -> Result<Option<String>, String> {
    let exts: Vec<&str> = extensions.iter().map(String::as_str).collect();
    let picked = app.dialog().file().add_filter(filter_name, &exts).blocking_pick_file();
    let Some(path) = picked else { return Ok(None) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    state.remember(path.clone());
    Ok(Some(path.to_string_lossy().into_owned()))
}

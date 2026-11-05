//! 更新のインストーラーを落として開く(設定 → このアプリについて → 更新)。
//! 落とした先は一時フォルダ(bbs-browser-update)。開くとインストーラーが立ち上がる(アプリは利用者が閉じる)

use std::io::Write;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub async fn download_update(app: tauri::AppHandle, url: String, name: String) -> Result<String, String> {
    // ファイル名はリリースの asset の名前だけを使う(フォルダをまたぐ名前は受け付けない)
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("インストーラーの名前が正しくありません".into());
    }
    let dir = app.path().temp_dir().map_err(|e| e.to_string())?.join("bbs-browser-update");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(&name);

    let client = reqwest::Client::builder().user_agent("bbs-browser").build().map_err(|e| e.to_string())?;
    let req = client.get(&url).header("Accept", "application/octet-stream").header("X-GitHub-Api-Version", "2022-11-28");
    let res = req.send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("落とせませんでした({})", res.status()));
    }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    let mut f = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    f.write_all(&bytes).map_err(|e| e.to_string())?;
    drop(f);
    let shown = path.to_string_lossy().to_string();
    app.opener().open_path(shown.clone(), None::<&str>).map_err(|e| e.to_string())?;
    Ok(shown)
}

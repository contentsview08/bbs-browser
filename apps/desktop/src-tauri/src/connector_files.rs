//! 外付けのコネクタ(アプリのデータフォルダの connectors/ の下)。フォルダごとに manifest.json と connector.js を読む。
//! 読むだけで、書き換えはしない。中のコードは画面側で、外と切り離した囲い(QuickJS。src/host/connectorSandbox.ts)の中で動かす

use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// 1 つのファイルの大きさの上限
const MAX_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Serialize)]
pub struct ConnectorFiles {
    /// フォルダの名前
    dir: String,
    /// manifest.json の中身(なければ None)
    manifest: Option<String>,
    /// connector.js の中身(なければ None)
    code: Option<String>,
    /// 読めなかった理由
    error: Option<String>,
}

fn connectors_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("connectors");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// ファイルを文字として読む。なければ None、大きすぎれば理由を返す
fn read_limited(path: &Path) -> Result<Option<String>, String> {
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return Ok(None),
    };
    if meta.len() > MAX_BYTES {
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        return Err(format!("{name} が大きすぎます(5MB まで)"));
    }
    std::fs::read_to_string(path).map(Some).map_err(|e| e.to_string())
}

/// connectors/ の下のフォルダを、名前の順に読む
#[tauri::command]
pub fn list_connector_files(app: tauri::AppHandle) -> Result<Vec<ConnectorFiles>, String> {
    let dir = connectors_path(&app)?;
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let manifest = read_limited(&path.join("manifest.json"));
        let code = read_limited(&path.join("connector.js"));
        let files = match (manifest, code) {
            (Ok(manifest), Ok(code)) => ConnectorFiles { dir: name, manifest, code, error: None },
            (Err(e), _) | (_, Err(e)) => ConnectorFiles { dir: name, manifest: None, code: None, error: Some(e) },
        };
        out.push(files);
    }
    out.sort_by(|a, b| a.dir.cmp(&b.dir));
    Ok(out)
}

/// connectors/ のフォルダの場所(設定の画面の「フォルダを開く」用)。なければ作る
#[tauri::command]
pub fn connectors_dir(app: tauri::AppHandle) -> Result<String, String> {
    Ok(connectors_path(&app)?.to_string_lossy().into_owned())
}

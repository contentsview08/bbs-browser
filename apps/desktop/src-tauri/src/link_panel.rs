//! リンクのパネル(設定「リンクをアプリの中で開く」)。外のページを、画像ビューアーのように主の窓の上に重ねて開く。
//! 外のページは iframe に入れられない(X-Frame-Options)ので、主の窓に子の webview(tauri の unstable)を置く。
//! 枠の暗がり・上の帯・閉じるボタンは主の画面(JS の LinkPanelFrame)が描き、子の webview はその内側に大きさを合わせて置く。
//! 外のページなので、この webview にはアプリの命令(IPC)の権限を与えない(capabilities に入れない)
use std::sync::Mutex;

use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl};

const LABEL: &str = "link-panel";

#[derive(Default)]
pub struct LinkPanel(Mutex<Option<tauri::Webview>>);

/// 主の画面の中の位置と大きさ(CSS の px = 論理ピクセル)
#[derive(serde::Deserialize, Clone, Copy)]
pub struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

fn parse(url: &str) -> Result<Url, String> {
    let page = Url::parse(url).map_err(|e| e.to_string())?;
    if !matches!(page.scheme(), "http" | "https") {
        return Err("http か https のリンクだけ開けます".into());
    }
    Ok(page)
}

/// パネルを開く(開いていれば同じ webview でそのページへ)
#[tauri::command]
pub fn open_link_panel(app: AppHandle, state: tauri::State<'_, LinkPanel>, url: String, rect: Rect) -> Result<(), String> {
    let page = parse(&url)?;
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(w) = slot.as_ref() {
        w.navigate(page).map_err(|e| e.to_string())?;
        let _ = w.set_position(LogicalPosition::new(rect.x, rect.y));
        let _ = w.set_size(LogicalSize::new(rect.w, rect.h));
        return Ok(());
    }
    let main = app.get_webview_window("main").ok_or("主の窓がありません")?;
    let window = main.as_ref().window();
    let webview = window
        .add_child(tauri::webview::WebviewBuilder::new(LABEL, WebviewUrl::External(page)), LogicalPosition::new(rect.x, rect.y), LogicalSize::new(rect.w, rect.h))
        .map_err(|e| e.to_string())?;
    *slot = Some(webview);
    Ok(())
}

/// 主の窓の大きさが変わったとき、パネルの位置と大きさを合わせる
#[tauri::command]
pub fn move_link_panel(state: tauri::State<'_, LinkPanel>, rect: Rect) -> Result<(), String> {
    let slot = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(w) = slot.as_ref() {
        w.set_position(LogicalPosition::new(rect.x, rect.y)).map_err(|e| e.to_string())?;
        w.set_size(LogicalSize::new(rect.w, rect.h)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn close_link_panel(state: tauri::State<'_, LinkPanel>) -> Result<(), String> {
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(w) = slot.take() {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// いま開いているページの URL(上の帯に出す。ページの中で移ったあとも)
#[tauri::command]
pub fn link_panel_url(state: tauri::State<'_, LinkPanel>) -> Result<Option<String>, String> {
    let slot = state.0.lock().map_err(|e| e.to_string())?;
    Ok(slot.as_ref().and_then(|w| w.url().ok()).map(|u| u.to_string()))
}

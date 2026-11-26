//! リンクのパネル(設定「リンクをアプリの中で開く」)。外のページを、画像ビューアーのように主の窓の上に重ねて開く。
//! 外のページは iframe に入れられない(X-Frame-Options)ので、枠のない小さな窓(WebviewWindow)を主の窓の中に置く。
//! Windows では主の窓の子ウィンドウ(parent)にするので、主の窓と一緒に動き・隠れ、主の画面(webview)より手前に出る。
//! 枠の暗がり・上の帯・閉じるボタンは主の画面(JS の LinkPanelFrame)が描き、この窓はその内側に大きさを合わせて置く。
//! 外のページなので、この窓にはアプリの命令(IPC)の権限を与えない(capabilities に入れない)。
//! 命令は async(同期の命令はメインのスレッドで動き、窓を作る・閉じる中でメインのスレッドを待って固まる)
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const LABEL: &str = "link-panel";

/// 主の画面の中の位置と大きさ(CSS の px = 論理ピクセル。主の窓のクライアント領域の左上が原点)
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

/// 窓を枠の内側に合わせる。Windows は子ウィンドウなので主の窓のクライアント領域からの位置、ほかは画面の位置に直す
fn place(main: &WebviewWindow, panel: &WebviewWindow, rect: Rect) {
    #[cfg(windows)]
    {
        let _ = main;
        let _ = panel.set_position(LogicalPosition::new(rect.x, rect.y));
    }
    #[cfg(not(windows))]
    {
        if let (Ok(origin), Ok(scale)) = (main.inner_position(), main.scale_factor()) {
            let _ = panel.set_position(tauri::PhysicalPosition::new(origin.x + (rect.x * scale) as i32, origin.y + (rect.y * scale) as i32));
        }
    }
    let _ = panel.set_size(LogicalSize::new(rect.w, rect.h));
}

/// パネルを開く(開いていれば同じ窓でそのページへ)
#[tauri::command]
pub async fn open_link_panel(app: AppHandle, url: String, rect: Rect) -> Result<(), String> {
    let page = parse(&url)?;
    let main = app.get_webview_window("main").ok_or("主の窓がありません")?;
    if let Some(w) = app.get_webview_window(LABEL) {
        w.navigate(page).map_err(|e| e.to_string())?;
        place(&main, &w, rect);
        let _ = w.show();
        return Ok(());
    }
    let mut b = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(page))
        .title("OBB のブラウザ")
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .inner_size(rect.w, rect.h)
        .focused(false);
    #[cfg(windows)]
    {
        b = b.parent(&main).map_err(|e| e.to_string())?.position(rect.x, rect.y);
    }
    #[cfg(not(windows))]
    {
        b = b.always_on_top(true);
        if let (Ok(origin), Ok(scale)) = (main.inner_position(), main.scale_factor()) {
            b = b.position(origin.x as f64 / scale + rect.x, origin.y as f64 / scale + rect.y);
        }
    }
    b.build().map_err(|e| e.to_string())?;
    Ok(())
}

/// 主の窓の大きさが変わったとき、パネルの位置と大きさを合わせる
#[tauri::command]
pub async fn move_link_panel(app: AppHandle, rect: Rect) -> Result<(), String> {
    if let (Some(main), Some(w)) = (app.get_webview_window("main"), app.get_webview_window(LABEL)) {
        place(&main, &w, rect);
    }
    Ok(())
}

#[tauri::command]
pub async fn close_link_panel(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(LABEL) {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// いま開いているページの URL(上の帯に出す。ページの中で移ったあとも)
#[tauri::command]
pub async fn link_panel_url(app: AppHandle) -> Result<Option<String>, String> {
    Ok(app.get_webview_window(LABEL).and_then(|w| w.url().ok()).map(|u| u.to_string()))
}

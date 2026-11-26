//! リンクのパネル(設定「リンクをアプリの中で開く」)。外のページを、画像ビューアーのように主の窓の上に重ねて開く。
//! 外のページは iframe に入れられない(X-Frame-Options)ので、枠のない小さな窓(WebviewWindow)を主の窓の中に置く。
//! Windows では主の窓に所有された窓(owner)にするので、いつも主の窓より手前に出て、主の窓を小さくすると一緒に隠れる。主の窓が動いたら追いかける(follow)。
//! 枠の暗がり・上の帯・閉じるボタンは主の画面(JS の LinkPanelFrame)が描き、この窓はその内側に大きさを合わせて置く。
//! 外のページなので、この窓にはアプリの命令(IPC)の権限を与えない(capabilities に入れない)。
//! 命令は async(同期の命令はメインのスレッドで動き、窓を作る・閉じる中でメインのスレッドを待って固まる)
use std::sync::Mutex;

use tauri::{AppHandle, LogicalSize, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const LABEL: &str = "link-panel";

/// 開く・閉じるを 1 つずつ(同時に 2 つの「開く」が走ると、どちらも「まだない」と見て窓を 2 つ作り、同じ名前なので 1 つが行き場をなくして
/// 消せなくなった。React の開発モードは effect を 2 回走らせるので起きやすい)
static LOCK: Mutex<()> = Mutex::new(());
/// 最後に「開く」を頼まれたときの通し番号。それより古い「閉じる」は無視する
/// (React の開発モードは 開く → 閉じる → 開く と続けて頼み、async の命令は順に届かないので、最後に古い閉じるが効いて窓が消えていた)
static CURRENT: Mutex<u64> = Mutex::new(0);

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

/// 最後に渡された枠の内側(主の窓が動いたときに追いかけるため)
static LAST: Mutex<Option<Rect>> = Mutex::new(None);

/// 枠の内側の画面上の位置(物理ピクセル)。主の窓のクライアント領域の左上 + 論理ピクセル × 倍率
fn screen_position(main: &WebviewWindow, rect: Rect) -> Option<tauri::PhysicalPosition<i32>> {
    let origin = main.inner_position().ok()?;
    let scale = main.scale_factor().ok()?;
    Some(tauri::PhysicalPosition::new(origin.x + (rect.x * scale).round() as i32, origin.y + (rect.y * scale).round() as i32))
}

/// 窓を枠の内側に合わせる(位置は画面の座標。所有された窓なので主の窓より手前に出る)
fn place(main: &WebviewWindow, panel: &WebviewWindow, rect: Rect) {
    if let Some(p) = screen_position(main, rect) {
        let _ = panel.set_position(p);
    }
    let _ = panel.set_size(LogicalSize::new(rect.w, rect.h));
    if let Ok(mut last) = LAST.lock() {
        *last = Some(rect);
    }
}

/// 主の窓の焦点が変わったとき(lib.rs の on_window_event から)。
/// 主の窓に戻ったらパネルを出す。主の窓が焦点を失い、少し待ってもパネルにも焦点がなければ(ほかのアプリへ移った)パネルを隠す
pub fn on_main_focus(app: &AppHandle, focused: bool) {
    let Some(w) = app.get_webview_window(LABEL) else { return };
    // 隠すのはやめた(is_focused は webview に焦点があると false を返し、出した直後に隠していた)。主の窓に戻ったら前に出すだけ
    if focused {
        let _ = w.show();
    }
}

/// 主の窓が動いた・大きさが変わったとき(lib.rs の on_window_event から)、パネルを追いかけさせる
pub fn follow(app: &AppHandle) {
    let Some(rect) = LAST.lock().ok().and_then(|l| *l) else { return };
    if let (Some(main), Some(w)) = (app.get_webview_window("main"), app.get_webview_window(LABEL)) {
        if let Some(p) = screen_position(&main, rect) {
            let _ = w.set_position(p);
        }
    }
}

/// パネルを開く(開いていれば同じ窓でそのページへ)
#[tauri::command]
pub async fn open_link_panel(app: AppHandle, url: String, rect: Rect, id: u64) -> Result<(), String> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if let Ok(mut c) = CURRENT.lock() {
        if id < *c {
            return Ok(());
        }
        *c = id;
    }
    let page = parse(&url)?;
    let main = app.get_webview_window("main").ok_or("主の窓がありません")?;
    if let Some(w) = app.get_webview_window(LABEL) {
        w.navigate(page).map_err(|e| e.to_string())?;
        place(&main, &w, rect);
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let mut b = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(page))
        .title("OBB のブラウザ")
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .inner_size(rect.w, rect.h)
        // 前に出して焦点も渡す(焦点を渡さずに出すと、動いている主の窓の下に置かれて見えないことがある)
        .focused(true)
        .visible(true);
    if let (Ok(origin), Ok(scale)) = (main.inner_position(), main.scale_factor()) {
        b = b.position(origin.x as f64 / scale + rect.x, origin.y as f64 / scale + rect.y);
    }
    // Windows: 主の窓に所有された窓(いつも主の窓より手前。主の窓を小さくすると一緒に隠れる。ほかのアプリの上には出ない)。
    // 「いつも手前(always_on_top)」にすると、ほかのアプリへ移ってもパネルだけが最前面に居座るのでやめた。
    // 見えなかった本当の原因は重なりではなく、開く → 閉じる → 開く の入れ違いで窓が消されていたこと(通し番号で直した)
    #[cfg(windows)]
    {
        b = b.owner(&main).map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        b = b.always_on_top(true);
    }
    if let Ok(mut last) = LAST.lock() {
        *last = Some(rect);
    }
    let w = b.build().map_err(|e| e.to_string())?;
    // 作ってから、物理ピクセルの画面の座標で置き直す。作るときの position(論理)は倍率の違う画面で別の所に置かれ、
    // 枠の内側にページが見えなかった(2 回目の開き直し = place を通る方だけ見えていたのが手がかり)
    place(&main, &w, rect);
    let _ = w.show();
    let _ = w.set_focus();
    Ok(())
}

/// 主の窓の大きさが変わったとき、パネルの位置と大きさを合わせる
#[tauri::command]
pub async fn move_link_panel(app: AppHandle, rect: Rect) -> Result<(), String> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if let (Some(main), Some(w)) = (app.get_webview_window("main"), app.get_webview_window(LABEL)) {
        place(&main, &w, rect);
    }
    Ok(())
}

#[tauri::command]
pub async fn close_link_panel(app: AppHandle, id: u64) -> Result<(), String> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    // そのあとに新しく開かれていたら、この閉じるは古い(無視)
    if CURRENT.lock().map(|c| id < *c).unwrap_or(false) {
        return Ok(());
    }
    for (label, w) in app.webview_windows() {
        if label == LABEL {
            let _ = w.destroy();
        }
    }
    Ok(())
}

/// いま開いているページの URL(上の帯に出す。ページの中で移ったあとも)
#[tauri::command]
pub async fn link_panel_url(app: AppHandle) -> Result<Option<String>, String> {
    Ok(app.get_webview_window(LABEL).and_then(|w| w.url().ok()).map(|u| u.to_string()))
}

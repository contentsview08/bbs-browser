//! OS の通知(Windows)。tauri-plugin-notification は Windows で「押したとき」を受け取れず、
//! インストールしていない版(ZIP 版・開発中)では PowerShell の名前とアイコンで出る。
//! ここでは WinRT のトーストを直に出し、押したら画面に知らせて(os-notify-click)窓を前に出す。
//! アプリの ID(AppUserModelID)は、レジストリ(HKCU\Software\Classes\AppUserModelId)に名前とアイコンを登録して使う
//! (ショートカットがなくても、インストールしていなくても、OBB の名前とアイコンで出る)

use tauri::{Emitter, Manager};

/// アプリの ID。tauri.conf.json の identifier と同じ
const AUMID: &str = "io.github.contentsview08.obb";
const ICON_PNG: &[u8] = include_bytes!("../icons/128x128.png");

/// 起動時: アプリの ID を登録する(名前・アイコン)。失敗しても通知は出る(名前とアイコンが PowerShell になるだけ)
pub fn register(app: &tauri::AppHandle) {
    let Ok(dir) = crate::data_dir(app) else { return };
    let icon = dir.join("notify-icon.png");
    if !icon.is_file() {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(&icon, ICON_PNG);
    }
    let Ok(key) = windows_registry::CURRENT_USER.create(format!("Software\\Classes\\AppUserModelId\\{AUMID}")) else { return };
    let _ = key.set_string("DisplayName", "OBB");
    let _ = key.set_string("IconUri", icon.to_string_lossy().as_ref());
}

/// 通知を出す。link は押したときに画面へ渡す文字(開くスレの JSON。画面がそのまま受け取る)。
/// silent なら OS の音を鳴らさない(アプリが自分の通知音を鳴らすので、二重に鳴らさない)
pub fn show(app: &tauri::AppHandle, title: &str, body: Option<&str>, link: Option<String>, silent: bool) -> Result<(), String> {
    use tauri_winrt_notification::{Duration, Toast};
    let mut toast = Toast::new(AUMID).title(title).duration(Duration::Short);
    if let Some(b) = body.filter(|b| !b.is_empty()) {
        toast = toast.text1(b);
    }
    if silent {
        toast = toast.sound(None);
    }
    let app = app.clone();
    toast = toast.on_activated(move |_| {
        let _ = app.emit("os-notify-click", link.clone());
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
        Ok(())
    });
    toast.show().map_err(|e| e.to_string())
}

//! メインの窓の位置と大きさを、データフォルダに覚える。
//! tauri-plugin-window-state は置き場が決め打ちで、ZIP 版の data\ に置けないので自前で持つ。
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WindowEvent};

const FILE: &str = "window-state.json";
const SAVE_DELAY: Duration = Duration::from_millis(500);
const MIN_WIDTH: u32 = 400;
const MIN_HEIGHT: u32 = 300;
/// 画面の外に消えないよう、窓の上の帯がこれだけ見えていること
const VISIBLE_WIDTH: i64 = 100;
const VISIBLE_HEIGHT: i64 = 40;

#[derive(serde::Serialize, serde::Deserialize, Clone, Copy, PartialEq, Debug)]
struct Saved {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
}

#[derive(Clone, Copy)]
struct Area {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

/// 窓の上の帯が、どれかの画面に十分見えるか(外した画面に置いたままだと、窓を見失う)
fn reachable(s: &Saved, screens: &[Area]) -> bool {
    screens.iter().any(|a| {
        let overlap = |start: i32, len: u32, other: i32, other_len: u32| {
            let from = i64::from(start).max(i64::from(other));
            let to = (i64::from(start) + i64::from(len)).min(i64::from(other) + i64::from(other_len));
            to - from
        };
        let band = (s.height as i64).min(VISIBLE_HEIGHT) as u32;
        overlap(s.x, s.width, a.x, a.width) >= VISIBLE_WIDTH && overlap(s.y, band, a.y, a.height) >= i64::from(band)
    })
}

fn usable(s: &Saved, screens: &[Area]) -> bool {
    s.width >= MIN_WIDTH && s.height >= MIN_HEIGHT && reachable(s, screens)
}

fn path_of(window: &WebviewWindow) -> Option<PathBuf> {
    Some(crate::data_dir(window.app_handle()).ok()?.join(FILE))
}

fn read(path: &Path) -> Option<Saved> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

/// 途中で落ちても壊れたファイルを残さない
fn write(path: &Path, s: &Saved) {
    let Ok(json) = serde_json::to_vec(s) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let tmp = path.with_extension("tmp");
    if std::fs::write(&tmp, json).is_ok() {
        let _ = std::fs::rename(&tmp, path);
    }
}

fn apply_saved(window: &WebviewWindow) {
    let Some(saved) = path_of(window).and_then(|p| read(&p)) else { return };
    let screens: Vec<Area> = window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| Area { x: m.position().x, y: m.position().y, width: m.size().width, height: m.size().height })
        .collect();
    if !usable(&saved, &screens) {
        return;
    }
    let _ = window.set_size(PhysicalSize::new(saved.width, saved.height));
    let _ = window.set_position(PhysicalPosition::new(saved.x, saved.y));
    if saved.maximized {
        let _ = window.maximize();
    }
}

/// 今の状態を current へ写す。最小化中は位置が画面の外の値になるので写さない。最大化中は元の大きさを残す
fn capture(window: &WebviewWindow, current: &Mutex<Option<Saved>>) -> Option<Saved> {
    if window.is_minimized().unwrap_or(false) {
        return None;
    }
    let mut slot = current.lock().ok()?;
    let maximized = window.is_maximized().unwrap_or(false);
    let next = if maximized {
        let mut s = (*slot)?;
        s.maximized = true;
        s
    } else {
        let p = window.outer_position().ok()?;
        let z = window.outer_size().ok()?;
        Saved { x: p.x, y: p.y, width: z.width, height: z.height, maximized: false }
    };
    *slot = Some(next);
    Some(next)
}

/// 起動時に前回の位置と大きさへ戻して窓を出し、以後の変化を覚える。窓は tauri.conf.json で隠して作る(動いて見えないように)
pub fn setup(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    apply_saved(&window);
    let _ = window.show();
    let Some(path) = path_of(&window) else { return };
    let current = Arc::new(Mutex::new(read(&path)));
    let generation = Arc::new(AtomicU64::new(0));
    let watched = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            let Some(next) = capture(&watched, &current) else { return };
            // 動かしている間は書かず、止まってから 1 回だけ書く
            let mine = generation.fetch_add(1, Ordering::SeqCst) + 1;
            let (generation, path) = (generation.clone(), path.clone());
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(SAVE_DELAY).await;
                if generation.load(Ordering::SeqCst) == mine {
                    write(&path, &next);
                }
            });
        }
        WindowEvent::CloseRequested { .. } => {
            if let Some(next) = capture(&watched, &current) {
                generation.fetch_add(1, Ordering::SeqCst);
                write(&path, &next);
            }
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Area = Area { x: 0, y: 0, width: 1920, height: 1080 };
    const SECOND: Area = Area { x: 1920, y: 0, width: 1280, height: 1024 };
    const fn saved(x: i32, y: i32) -> Saved {
        Saved { x, y, width: 1280, height: 800, maximized: false }
    }

    #[test]
    fn 画面の中なら戻す() {
        assert!(usable(&saved(100, 100), &[SCREEN]));
        assert!(usable(&saved(2000, 50), &[SCREEN, SECOND]));
    }

    #[test]
    fn 外した画面の位置には戻さない() {
        assert!(!usable(&saved(2000, 50), &[SCREEN]));
        assert!(!usable(&saved(-5000, 100), &[SCREEN]));
    }

    #[test]
    fn 上の帯が画面の外なら戻さない() {
        assert!(!usable(&saved(100, -200), &[SCREEN]));
        assert!(!usable(&saved(100, 1060), &[SCREEN]));
    }

    #[test]
    fn 右へはみ出しても帯が見えれば戻す() {
        assert!(usable(&saved(1800, 100), &[SCREEN]));
        assert!(!usable(&saved(1860, 100), &[SCREEN]));
    }

    #[test]
    fn 小さすぎる値は戻さない() {
        assert!(!usable(&Saved { x: 0, y: 0, width: 10, height: 10, maximized: false }, &[SCREEN]));
    }

    #[test]
    fn 壊れたファイルは読まない() {
        let dir = std::env::temp_dir().join(format!("obb-window-state-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FILE);
        std::fs::write(&path, "{").unwrap();
        assert_eq!(read(&path), None);
        let s = saved(1, 2);
        write(&path, &s);
        assert_eq!(read(&path), Some(s));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

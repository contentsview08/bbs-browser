//! 同期を始めるページを別の窓で開き、ページの移動を止めて許可証を受け取る。理由は docs/sync-design.md の「許可証の受け渡し」。
//! 開いたページはアプリの命令を呼べない(この窓は capabilities の対象でなく、外のページから自前の命令へも届かない)。
//! 許可証は main だけへ渡す。

use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::sync_http::{only_main, url_allowed};

const LABEL: &str = "sync-start";
const TURNSTILE_HOST: &str = "challenges.cloudflare.com";

#[derive(Debug, PartialEq)]
enum Nav {
    Ticket(String),
    Allow,
    Block,
}

/// 窓の中で動ける先は、同期サーバーと確認の部品だけ
fn navigation(u: &Url, server: &Url) -> Nav {
    if u.scheme() == "https" && u.host_str() == Some("obb-sync.invalid") && u.path() == "/ticket" {
        return match u.query_pairs().find(|(k, _)| k == "ticket") {
            Some((_, v)) => Nav::Ticket(v.into_owned()),
            None => Nav::Block,
        };
    }
    let is_server = u.origin() == server.origin();
    let is_turnstile = u.scheme() == "https" && u.host_str() == Some(TURNSTILE_HOST);
    let is_blank = u.scheme() == "about" && matches!(u.path(), "blank" | "srcdoc");
    if is_server || is_turnstile || is_blank {
        Nav::Allow
    } else {
        Nav::Block
    }
}

fn start_url(url: &str, dev: bool) -> Result<Url, String> {
    let page: Url = url.parse().map_err(|_| "bad_url".to_string())?;
    if !url_allowed(&page, dev) || page.path() != "/start" {
        return Err("bad_url".into());
    }
    Ok(page)
}

#[tauri::command]
pub async fn close_sync_start(app: AppHandle, window: tauri::Window) -> Result<(), String> {
    only_main(&window)?;
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.close();
    }
    Ok(())
}

#[tauri::command]
pub async fn open_sync_start(app: AppHandle, window: tauri::Window, url: String) -> Result<(), String> {
    only_main(&window)?;
    let page = start_url(&url, cfg!(debug_assertions))?;
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.set_focus();
        return Ok(());
    }
    let server = page.clone();
    let for_nav = app.clone();
    let built = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(page))
        .title("同期を始める")
        .inner_size(480.0, 640.0)
        .on_navigation(move |u| match navigation(u, &server) {
            Nav::Ticket(ticket) => {
                let _ = for_nav.emit_to("main", "sync-start-ticket", ticket);
                false
            }
            Nav::Allow => true,
            Nav::Block => false,
        })
        .build()
        .map_err(|_| "window_failed".to_string())?;
    let for_close = app.clone();
    built.on_window_event(move |e| {
        if matches!(e, WindowEvent::Destroyed) {
            let _ = for_close.emit_to("main", "sync-start-closed", ());
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nav(u: &str) -> Nav {
        navigation(&u.parse().unwrap(), &"https://sync.example.test/start?space_id=a&return=app".parse().unwrap())
    }

    #[test]
    fn 許可証の移動を止めて受け取る() {
        assert_eq!(nav("https://obb-sync.invalid/ticket?ticket=v1.a.b"), Nav::Ticket("v1.a.b".into()));
        assert_eq!(nav("https://obb-sync.invalid/ticket"), Nav::Block);
        assert_eq!(nav("https://obb-sync.invalid/other?ticket=x"), Nav::Block);
        assert_eq!(nav("http://obb-sync.invalid/ticket?ticket=x"), Nav::Block);
    }

    #[test]
    fn 同期サーバーと確認の部品のほかへ移らない() {
        assert_eq!(nav("https://sync.example.test/start?space_id=a&return=app"), Nav::Allow);
        assert_eq!(nav("https://challenges.cloudflare.com/turnstile/v0/x"), Nav::Allow);
        assert_eq!(nav("about:blank"), Nav::Allow);
        assert_eq!(nav("about:srcdoc"), Nav::Allow);
        assert_eq!(nav("https://evil.example.test/"), Nav::Block);
        assert_eq!(nav("http://sync.example.test/"), Nav::Block);
        assert_eq!(nav("http://challenges.cloudflare.com/"), Nav::Block);
        assert_eq!(nav("javascript:alert(1)"), Nav::Block);
    }

    #[test]
    fn 開けるのは_start_だけ() {
        assert!(start_url("https://sync.example.test/start?space_id=a&return=app", false).is_ok());
        assert!(start_url("https://sync.example.test/other", false).is_err());
        assert!(start_url("http://sync.example.test/start", false).is_err());
        assert!(start_url("http://localhost:8787/start", false).is_err());
        assert!(start_url("http://localhost:8787/start", true).is_ok());
    }

    #[test]
    fn 開く窓は権限の対象に入らない() {
        let caps: serde_json::Value = serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let windows = caps["windows"].as_array().unwrap();
        assert!(!windows.iter().any(|w| w == LABEL || w == "*"));
        assert!(caps.get("remote").is_none());
    }
}

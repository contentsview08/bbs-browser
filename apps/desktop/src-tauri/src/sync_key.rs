//! K・許可証・device_id を OS の鍵保管に置く(Windows の資格情報・Linux の Secret Service)。
//! データフォルダの外にあるので、DB の書き出しにも ZIP 版のフォルダにも入らない。
//! 値は画面が組み立てた JSON のまま預かり、中身を見ない。失敗の文に値を入れない。

use std::sync::OnceLock;

use keyring_core::{Entry, Error};

use crate::sync_http::only_main;

const SERVICE: &str = "OBB sync";
const USER: &str = "keys";
const VALUE_MAX: usize = 2000;
const UNAVAILABLE: &str = "key_store_unavailable";

fn make_store() -> Result<(), ()> {
    #[cfg(target_os = "windows")]
    {
        keyring_core::set_default_store(windows_native_keyring_store::Store::new().map_err(|_| ())?);
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        keyring_core::set_default_store(zbus_secret_service_keyring_store::Store::new().map_err(|_| ())?);
        Ok(())
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        Err(())
    }
}

fn entry(service: &str) -> Result<Entry, String> {
    static READY: OnceLock<Result<(), ()>> = OnceLock::new();
    READY.get_or_init(make_store).map_err(|_| UNAVAILABLE.to_string())?;
    Entry::new(service, USER).map_err(|_| UNAVAILABLE.to_string())
}

fn load(service: &str) -> Result<Option<String>, String> {
    match entry(service)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(Error::NoEntry) => Ok(None),
        Err(_) => Err(UNAVAILABLE.into()),
    }
}

fn save(service: &str, value: &str) -> Result<(), String> {
    if value.len() > VALUE_MAX {
        return Err("too_large".into());
    }
    entry(service)?.set_password(value).map_err(|_| UNAVAILABLE.to_string())
}

fn clear(service: &str) -> Result<(), String> {
    match entry(service)?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(_) => Err(UNAVAILABLE.into()),
    }
}

/// Secret Service の呼び出しは待つことがあるので、画面の処理を止めない
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|_| UNAVAILABLE.to_string())?
}

#[tauri::command]
pub async fn sync_key_load(window: tauri::Window) -> Result<Option<String>, String> {
    only_main(&window)?;
    blocking(|| load(SERVICE)).await
}

#[tauri::command]
pub async fn sync_key_save(window: tauri::Window, value: String) -> Result<(), String> {
    only_main(&window)?;
    blocking(move || save(SERVICE, &value)).await
}

#[tauri::command]
pub async fn sync_key_clear(window: tauri::Window) -> Result<(), String> {
    only_main(&window)?;
    blocking(|| clear(SERVICE)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_SERVICE: &str = "OBB sync test";

    /// 本物の鍵保管を使う。Secret Service のない環境では、理由を返すことまでを確かめる
    #[test]
    fn 読み書きして消せる() {
        let cleared = clear(TEST_SERVICE);
        if cfg!(target_os = "windows") {
            cleared.clone().unwrap();
        }
        if let Err(e) = cleared {
            assert_eq!(e, UNAVAILABLE);
            assert_eq!(save(TEST_SERVICE, "x").unwrap_err(), UNAVAILABLE);
            return;
        }
        assert_eq!(load(TEST_SERVICE).unwrap(), None);
        let value = format!("{{\"k\":\"日本語も通る\",\"ticket\":\"{}\"}}", "v".repeat(400));
        save(TEST_SERVICE, &value).unwrap();
        assert_eq!(load(TEST_SERVICE).unwrap().as_deref(), Some(value.as_str()));
        save(TEST_SERVICE, "2").unwrap();
        assert_eq!(load(TEST_SERVICE).unwrap().as_deref(), Some("2"));
        clear(TEST_SERVICE).unwrap();
        assert_eq!(load(TEST_SERVICE).unwrap(), None);
        clear(TEST_SERVICE).unwrap();
    }

    #[test]
    fn 大きすぎる値は置かない() {
        assert_eq!(save(TEST_SERVICE, &"x".repeat(VALUE_MAX + 1)).unwrap_err(), "too_large");
    }
}

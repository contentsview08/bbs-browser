//! K・許可証・device_id を OS の鍵保管に置く(Windows の資格情報・Linux の Secret Service)。
//! データフォルダの外にあるので、DB の書き出しにも ZIP 版のフォルダにも入らない。
//! 値は画面が組み立てた JSON のまま預かり、中身を見ない。失敗の文に値を入れない。
//! 鍵は DB と組で意味を持つ(DB の device_id と鍵の device_id を比べる)ので、名前に DB の置き場の目印を入れる。
//! 置き場ごとに分けないと、インストーラー版と ZIP 版が同じ鍵を上書きし合い、起動のたびに互いを作り直させる

use std::path::Path;
use std::sync::{Mutex, OnceLock};

use keyring_core::{Entry, Error};
use sha2::{Digest, Sha256};
use tauri::Manager;

use crate::sync_http::only_main;

const SERVICE: &str = "OBB sync";
/// 置き場の目印を入れる前の名前。インストーラー版だけがこの鍵を引き継ぐ
const LEGACY_USER: &str = "keys";
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

fn entry(service: &str, user: &str) -> Result<Entry, String> {
    static READY: OnceLock<Result<(), ()>> = OnceLock::new();
    READY.get_or_init(make_store).map_err(|_| UNAVAILABLE.to_string())?;
    Entry::new(service, user).map_err(|_| UNAVAILABLE.to_string())
}

/// DB の置き場ごとの鍵の名前。開発ビルドもインストーラー版と同じ DB を開くので、同じ名前になる(DB と鍵の組を崩さない)
fn user_for(db_dir: &Path) -> String {
    let digest = Sha256::digest(db_dir.to_string_lossy().as_bytes());
    let hex: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
    format!("{LEGACY_USER}-{hex}")
}

/// 古い名前の鍵を新しい名前へ移す。新しい名前に鍵があれば何もしない(古い方は別の置き場の鍵かもしれない)
fn migrate(service: &str, from: &str, to: &str) -> Result<(), String> {
    if load(service, to)?.is_some() {
        return Ok(());
    }
    let Some(value) = load(service, from)? else { return Ok(()) };
    save(service, to, &value)?;
    clear(service, from)
}

/// この置き場の鍵の名前。インストーラー版の置き場なら、最初の 1 回だけ古い名前の鍵を引き継ぐ。
/// ZIP 版は古い鍵を読まない(古い鍵はインストーラー版のものかもしれず、読むと取り合いが続く)
fn prepare(db_dir: &Path, portable: bool) -> Result<String, String> {
    static MIGRATED: Mutex<bool> = Mutex::new(false);
    let user = user_for(db_dir);
    if !portable {
        let mut done = MIGRATED.lock().map_err(|_| UNAVAILABLE.to_string())?;
        if !*done {
            migrate(SERVICE, LEGACY_USER, &user)?;
            *done = true;
        }
    }
    Ok(user)
}

fn place(window: &tauri::Window) -> Result<(std::path::PathBuf, bool), String> {
    only_main(window)?;
    Ok((crate::db_dir(window.app_handle())?, crate::portable_dir().is_some()))
}

fn load(service: &str, user: &str) -> Result<Option<String>, String> {
    match entry(service, user)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(Error::NoEntry) => Ok(None),
        Err(_) => Err(UNAVAILABLE.into()),
    }
}

fn save(service: &str, user: &str, value: &str) -> Result<(), String> {
    if value.len() > VALUE_MAX {
        return Err("too_large".into());
    }
    entry(service, user)?.set_password(value).map_err(|_| UNAVAILABLE.to_string())
}

fn clear(service: &str, user: &str) -> Result<(), String> {
    match entry(service, user)?.delete_credential() {
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
    let (dir, portable) = place(&window)?;
    blocking(move || load(SERVICE, &prepare(&dir, portable)?)).await
}

#[tauri::command]
pub async fn sync_key_save(window: tauri::Window, value: String) -> Result<(), String> {
    let (dir, portable) = place(&window)?;
    blocking(move || save(SERVICE, &prepare(&dir, portable)?, &value)).await
}

#[tauri::command]
pub async fn sync_key_clear(window: tauri::Window) -> Result<(), String> {
    let (dir, portable) = place(&window)?;
    blocking(move || clear(SERVICE, &prepare(&dir, portable)?)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_SERVICE: &str = "OBB sync test";
    const TEST_USER: &str = "keys-test";

    /// 鍵保管のない環境(Secret Service のない Linux)か。Windows では必ず使える
    fn unavailable(service: &str, user: &str) -> bool {
        let cleared = clear(service, user);
        if cfg!(target_os = "windows") {
            cleared.clone().unwrap();
        }
        match cleared {
            Ok(()) => false,
            Err(e) => {
                assert_eq!(e, UNAVAILABLE);
                assert_eq!(save(service, user, "x").unwrap_err(), UNAVAILABLE);
                true
            }
        }
    }

    /// 本物の鍵保管を使う。Secret Service のない環境では、理由を返すことまでを確かめる
    #[test]
    fn 読み書きして消せる() {
        if unavailable(TEST_SERVICE, TEST_USER) {
            return;
        }
        assert_eq!(load(TEST_SERVICE, TEST_USER).unwrap(), None);
        let value = format!("{{\"k\":\"日本語も通る\",\"ticket\":\"{}\"}}", "v".repeat(400));
        save(TEST_SERVICE, TEST_USER, &value).unwrap();
        assert_eq!(load(TEST_SERVICE, TEST_USER).unwrap().as_deref(), Some(value.as_str()));
        save(TEST_SERVICE, TEST_USER, "2").unwrap();
        assert_eq!(load(TEST_SERVICE, TEST_USER).unwrap().as_deref(), Some("2"));
        clear(TEST_SERVICE, TEST_USER).unwrap();
        assert_eq!(load(TEST_SERVICE, TEST_USER).unwrap(), None);
        clear(TEST_SERVICE, TEST_USER).unwrap();
    }

    #[test]
    fn 大きすぎる値は置かない() {
        assert_eq!(save(TEST_SERVICE, TEST_USER, &"x".repeat(VALUE_MAX + 1)).unwrap_err(), "too_large");
    }

    #[test]
    fn 置き場ごとに名前が分かれる() {
        let installed = user_for(Path::new(r"C:\Users\u\AppData\Roaming\io.github.contentsview08.obb"));
        let zip_a = user_for(Path::new(r"D:\OBB\data"));
        let zip_b = user_for(Path::new(r"E:\tools\OBB\data"));
        assert_eq!(installed, user_for(Path::new(r"C:\Users\u\AppData\Roaming\io.github.contentsview08.obb")));
        assert_ne!(installed, zip_a);
        assert_ne!(zip_a, zip_b);
        assert_ne!(installed, LEGACY_USER);
        assert!(installed.starts_with("keys-"));
        assert_eq!(installed.len(), "keys-".len() + 16);
        assert!(installed["keys-".len()..].bytes().all(|b| b.is_ascii_hexdigit()));
    }

    #[test]
    fn 古い名前の鍵を一度だけ移す() {
        const SERVICE: &str = "OBB sync test migrate";
        let (old, new) = ("keys", "keys-0123456789abcdef");
        if unavailable(SERVICE, old) {
            return;
        }
        clear(SERVICE, new).unwrap();
        // 古い鍵がなければ何も作らない
        migrate(SERVICE, old, new).unwrap();
        assert_eq!(load(SERVICE, new).unwrap(), None);

        save(SERVICE, old, "A").unwrap();
        migrate(SERVICE, old, new).unwrap();
        assert_eq!(load(SERVICE, new).unwrap().as_deref(), Some("A"));
        assert_eq!(load(SERVICE, old).unwrap(), None, "移したら古い方は消す");

        // 新しい名前に鍵があれば、古い名前に何があっても上書きしない
        save(SERVICE, old, "B").unwrap();
        migrate(SERVICE, old, new).unwrap();
        assert_eq!(load(SERVICE, new).unwrap().as_deref(), Some("A"));
        assert_eq!(load(SERVICE, old).unwrap().as_deref(), Some("B"));

        clear(SERVICE, old).unwrap();
        clear(SERVICE, new).unwrap();
    }
}

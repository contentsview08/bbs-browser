use std::collections::BTreeMap;

use tauri_plugin_sql::{Migration, MigrationKind};

/// OS に入っているフォント 1 ファミリーぶん
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemFont {
    /// CSS の font-family に書く名前(英語名)
    family: String,
    /// 日本語の名前があれば(「BIZ UDゴシック」など)
    local_name: Option<String>,
    monospaced: bool,
}

/// OS のフォントをファミリーごとにまとめて返す。WebView からは一覧を取れないので Rust 側で列挙する
#[tauri::command]
async fn list_system_fonts() -> Vec<SystemFont> {
    // フォントファイルを数百読むので、画面を止めないよう別スレッドで
    tauri::async_runtime::spawn_blocking(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        let mut fonts: BTreeMap<String, SystemFont> = BTreeMap::new();
        for face in db.faces() {
            let Some((family, _)) = face.families.first() else { continue };
            let local_name = face
                .families
                .iter()
                .find(|(_, lang)| *lang == fontdb::Language::Japanese_Japan)
                .map(|(name, _)| name.clone());
            let entry = fonts.entry(family.clone()).or_insert_with(|| SystemFont {
                family: family.clone(),
                local_name: None,
                monospaced: false,
            });
            entry.local_name = entry.local_name.take().or(local_name);
            entry.monospaced |= face.monospaced;
        }
        fonts.into_values().collect()
    })
    .await
    .unwrap_or_default()
}

/// フロントの `Database.load()` に渡す接続文字列。DB は %APPDATA%\<identifier>\ に置かれる
const DB_URL: &str = "sqlite:bbs-browser.db";

fn migrations() -> Vec<Migration> {
    // SQL は packages/logstore にあり、vitest のテストでも同じファイルを使う
    vec![
        Migration {
            version: 1,
            description: "init",
            sql: include_str!("../../../../packages/logstore/migrations/001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "settings",
            sql: include_str!("../../../../packages/logstore/migrations/002_settings.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "favorite_boards",
            sql: include_str!("../../../../packages/logstore/migrations/003_favorite_boards.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "own_posts",
            sql: include_str!("../../../../packages/logstore/migrations/004_own_posts.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![list_system_fonts])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

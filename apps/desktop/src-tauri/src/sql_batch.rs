//! 画面からの SQL の口。tauri-plugin-sql の execute・select を画面に許さず、ここを通す。
//! - 複数の文を 1 つのトランザクションで流す(plugin の execute はプールのどの接続へ行くか決まらず、JS から BEGIN を送れないため)
//! - 別のファイルを開く・書く文(ATTACH・VACUUM INTO など)を断る。画面のスクリプトが乗っ取られても、
//!   ダイアログで選んだパスだけを読み書きする決まり(chosen_paths.rs)を SQL で抜けられないようにするため
use serde_json::{Map, Value as JsonValue};
use sqlx::sqlite::{SqliteArguments, SqliteRow, SqliteValueRef};
use sqlx::{query::Query, Column, Pool, Row, Sqlite, TypeInfo, Value, ValueRef};
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

#[derive(serde::Deserialize)]
pub struct SqlStatement {
    sql: String,
    #[serde(default)]
    params: Vec<JsonValue>,
}

/// 画面から流させない語。ATTACH・DETACH は任意のパスに DB を作れる。VACUUM は INTO で任意のパスへ書ける(バックアップは backup_db で行う)。
/// load_extension は既定で切れているが、念のため
const FORBIDDEN: [&str; 4] = ["ATTACH", "DETACH", "VACUUM", "LOAD_EXTENSION"];

/// 文字列・識別子の引用・注釈の外にある語を見て、断る語があればそれを返す
fn forbidden_word(sql: &str) -> Option<&'static str> {
    let chars: Vec<char> = sql.chars().collect();
    let mut i = 0;
    let mut word = String::new();
    let check = |w: &mut String| -> Option<&'static str> {
        let hit = FORBIDDEN.iter().find(|f| w.eq_ignore_ascii_case(f)).copied();
        w.clear();
        hit
    };
    while i < chars.len() {
        let c = chars[i];
        if c.is_ascii_alphanumeric() || c == '_' || c == '$' || !c.is_ascii() {
            word.push(c);
            i += 1;
            continue;
        }
        if let Some(hit) = check(&mut word) {
            return Some(hit);
        }
        match c {
            // 文字列と引用した識別子は、同じ引用符 2 つで 1 文字
            '\'' | '"' | '`' => {
                i += 1;
                while i < chars.len() {
                    if chars[i] == c {
                        if chars.get(i + 1) == Some(&c) {
                            i += 2;
                            continue;
                        }
                        break;
                    }
                    i += 1;
                }
                i += 1;
            }
            '[' => {
                while i < chars.len() && chars[i] != ']' {
                    i += 1;
                }
                i += 1;
            }
            '-' if chars.get(i + 1) == Some(&'-') => {
                while i < chars.len() && chars[i] != '\n' {
                    i += 1;
                }
            }
            '/' if chars.get(i + 1) == Some(&'*') => {
                i += 2;
                while i < chars.len() && !(chars[i] == '*' && chars.get(i + 1) == Some(&'/')) {
                    i += 1;
                }
                i += 2;
            }
            _ => i += 1,
        }
    }
    check(&mut word)
}

fn guard(sql: &str) -> Result<(), String> {
    match forbidden_word(sql) {
        Some(w) => Err(format!("画面からは {w} の文を流せません")),
        None => Ok(()),
    }
}

/// 値の変換は tauri-plugin-sql の execute と同じ。数は f64 で渡すので、TEXT の列には文字列で渡す
fn bind<'q>(sql: &'q str, params: &[JsonValue]) -> Query<'q, Sqlite, SqliteArguments<'q>> {
    let mut query = sqlx::query(sql);
    for value in params {
        query = if value.is_null() {
            query.bind(None::<JsonValue>)
        } else if let Some(text) = value.as_str() {
            query.bind(text.to_owned())
        } else if let Some(number) = value.as_number() {
            query.bind(number.as_f64().unwrap_or_default())
        } else {
            query.bind(value.clone())
        };
    }
    query
}

async fn run_batch(pool: &Pool<Sqlite>, statements: Vec<SqlStatement>) -> Result<(), String> {
    for s in &statements {
        guard(&s.sql)?;
    }
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for s in &statements {
        bind(&s.sql, &s.params).execute(&mut *tx).await.map_err(|e| e.to_string())?;
    }
    // 途中で ? で返ると tx が落ちて巻き戻る
    tx.commit().await.map_err(|e| e.to_string())
}

/// 値の読み方は tauri-plugin-sql の select と同じ(日時の型は使っていないので、読めない型は文字か null にする)
fn to_json(v: SqliteValueRef) -> JsonValue {
    if v.is_null() {
        return JsonValue::Null;
    }
    let owned = v.to_owned();
    match v.type_info().name() {
        "REAL" => owned.try_decode::<f64>().map(JsonValue::from).unwrap_or(JsonValue::Null),
        "INTEGER" | "NUMERIC" => owned.try_decode::<i64>().map(JsonValue::from).unwrap_or(JsonValue::Null),
        "BOOLEAN" => owned.try_decode::<bool>().map(JsonValue::Bool).unwrap_or(JsonValue::Null),
        "BLOB" => owned.try_decode::<Vec<u8>>().map(|b| JsonValue::Array(b.into_iter().map(JsonValue::from).collect())).unwrap_or(JsonValue::Null),
        _ => owned.try_decode::<String>().map(JsonValue::String).unwrap_or(JsonValue::Null),
    }
}

fn row_json(row: &SqliteRow) -> Result<JsonValue, String> {
    let mut out = Map::new();
    for (i, column) in row.columns().iter().enumerate() {
        out.insert(column.name().to_string(), to_json(row.try_get_raw(i).map_err(|e| e.to_string())?));
    }
    Ok(JsonValue::Object(out))
}

async fn run_select(pool: &Pool<Sqlite>, sql: &str, params: &[JsonValue]) -> Result<Vec<JsonValue>, String> {
    guard(sql)?;
    let rows = bind(sql, params).fetch_all(pool).await.map_err(|e| e.to_string())?;
    rows.iter().map(row_json).collect()
}

async fn run_execute(pool: &Pool<Sqlite>, sql: &str, params: &[JsonValue]) -> Result<(), String> {
    guard(sql)?;
    bind(sql, params).execute(pool).await.map_err(|e| e.to_string())?;
    Ok(())
}

/// アプリの DB のプール。plugin の load(画面の Database.load)で開いたもの
pub(crate) async fn with_pool<T>(app: &AppHandle, f: impl AsyncFnOnce(&Pool<Sqlite>) -> Result<T, String>) -> Result<T, String> {
    let instances = app.state::<DbInstances>();
    let pools = instances.0.read().await;
    let Some(DbPool::Sqlite(pool)) = pools.get(&crate::db_url()) else {
        return Err("db_not_loaded".into());
    };
    f(pool).await
}

#[tauri::command]
pub async fn sql_batch(app: AppHandle, statements: Vec<SqlStatement>) -> Result<(), String> {
    with_pool(&app, async |pool| run_batch(pool, statements).await).await
}

#[tauri::command]
pub async fn sql_execute(app: AppHandle, sql: String, params: Vec<JsonValue>) -> Result<(), String> {
    with_pool(&app, async |pool| run_execute(pool, &sql, &params).await).await
}

#[tauri::command]
pub async fn sql_select(app: AppHandle, sql: String, params: Vec<JsonValue>) -> Result<Vec<JsonValue>, String> {
    with_pool(&app, async |pool| run_select(pool, &sql, &params).await).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    fn stmt(sql: &str, params: Vec<JsonValue>) -> SqlStatement {
        SqlStatement { sql: sql.into(), params }
    }

    async fn pool() -> Pool<Sqlite> {
        let pool = SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL)").execute(&pool).await.unwrap();
        pool
    }

    async fn count(pool: &Pool<Sqlite>) -> i64 {
        let (n,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM t").fetch_one(pool).await.unwrap();
        n
    }

    #[test]
    fn all_statements_are_committed() {
        tauri::async_runtime::block_on(async {
            let pool = pool().await;
            let batch = vec![
                stmt("INSERT INTO t (id, name) VALUES ($1, $2)", vec![1.into(), "a".into()]),
                stmt("INSERT INTO t (id, name) VALUES ($1, $2)", vec![2.into(), "b".into()]),
            ];
            run_batch(&pool, batch).await.unwrap();
            assert_eq!(count(&pool).await, 2);
        });
    }

    #[test]
    fn a_failed_statement_rolls_everything_back() {
        tauri::async_runtime::block_on(async {
            let pool = pool().await;
            let batch = vec![
                stmt("INSERT INTO t (id, name) VALUES ($1, $2)", vec![1.into(), "a".into()]),
                // NOT NULL に当たる
                stmt("INSERT INTO t (id, name) VALUES ($1, $2)", vec![2.into(), JsonValue::Null]),
            ];
            assert!(run_batch(&pool, batch).await.is_err());
            assert_eq!(count(&pool).await, 0);
        });
    }

    #[test]
    fn integers_stay_integers_in_integer_columns() {
        tauri::async_runtime::block_on(async {
            let pool = pool().await;
            let at: i64 = 1_800_000_000_123;
            run_batch(&pool, vec![stmt("INSERT INTO t (id, name) VALUES ($1, $2)", vec![at.into(), "a".into()])]).await.unwrap();
            let (id,): (i64,) = sqlx::query_as("SELECT id FROM t").fetch_one(&pool).await.unwrap();
            assert_eq!(id, at);
        });
    }

    #[test]
    fn 別のファイルを開く文は流さない() {
        for sql in [
            "ATTACH DATABASE 'C:/x.bat' AS a",
            "attach 'x' as a",
            "SELECT 1; ATTACH 'x' AS a",
            "DETACH a",
            "VACUUM INTO 'C:/x.db'",
            "vacuum",
            "SELECT load_extension('x')",
            "/* c */ATTACH 'x' AS a",
        ] {
            assert!(forbidden_word(sql).is_some(), "{sql}");
        }
        for sql in [
            "SELECT * FROM t WHERE name = 'ATTACH DATABASE'",
            "INSERT INTO t (id, name) VALUES ($1, $2) -- vacuum",
            "SELECT \"attach\" FROM t",
            "SELECT attachments, vacuumed FROM t /* ATTACH */",
            "SELECT 'it''s ATTACH' AS x",
        ] {
            assert!(forbidden_word(sql).is_none(), "{sql}");
        }
    }

    #[test]
    fn 断る文は一つでもあればまとめて流さない() {
        tauri::async_runtime::block_on(async {
            let pool = pool().await;
            let batch = vec![
                stmt("INSERT INTO t (id, name) VALUES ($1, $2)", vec![1.into(), "a".into()]),
                stmt("ATTACH DATABASE ':memory:' AS a", vec![]),
            ];
            assert!(run_batch(&pool, batch).await.is_err());
            assert_eq!(count(&pool).await, 0);
            assert!(run_execute(&pool, "ATTACH DATABASE ':memory:' AS a", &[]).await.is_err());
            assert!(run_select(&pool, "SELECT 1; ATTACH DATABASE ':memory:' AS a", &[]).await.is_err());
        });
    }

    #[test]
    fn 読んだ値は型のまま返す() {
        tauri::async_runtime::block_on(async {
            let pool = pool().await;
            run_execute(&pool, "INSERT INTO t (id, name) VALUES ($1, $2)", &[1_800_000_000_123i64.into(), "あ".into()]).await.unwrap();
            let rows = run_select(&pool, "SELECT id, name, NULL AS n, 1.5 AS r FROM t WHERE id = $1", &[1_800_000_000_123i64.into()]).await.unwrap();
            assert_eq!(rows, vec![serde_json::json!({ "id": 1_800_000_000_123i64, "name": "あ", "n": null, "r": 1.5 })]);
        });
    }

    #[test]
    fn 画面には_plugin_の文の口を許さない() {
        let caps: serde_json::Value = serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let perms: Vec<String> = caps["permissions"].as_array().unwrap().iter().filter_map(|p| p.as_str().map(str::to_owned)).collect();
        for p in ["sql:default", "sql:allow-execute", "sql:allow-select"] {
            assert!(!perms.iter().any(|x| x == p), "{p}");
        }
    }
}

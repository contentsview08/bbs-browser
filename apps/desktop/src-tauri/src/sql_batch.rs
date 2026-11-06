//! 複数の文を 1 つのトランザクションで流す。tauri-plugin-sql の execute はプールのどの接続へ行くか決まらず、JS から BEGIN を送れないため
use serde_json::Value as JsonValue;
use sqlx::{Pool, Sqlite};
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

#[derive(serde::Deserialize)]
pub struct SqlStatement {
    sql: String,
    #[serde(default)]
    params: Vec<JsonValue>,
}

/// 値の変換は tauri-plugin-sql の execute と同じ。数は f64 で渡すので、TEXT の列には文字列で渡す
async fn run_batch(pool: &Pool<Sqlite>, statements: Vec<SqlStatement>) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    for s in &statements {
        let mut query = sqlx::query(&s.sql);
        for value in &s.params {
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
        query.execute(&mut *tx).await?;
    }
    // 途中で ? で返ると tx が落ちて巻き戻る
    tx.commit().await
}

#[tauri::command]
pub async fn sql_batch(app: AppHandle, statements: Vec<SqlStatement>) -> Result<(), String> {
    let instances = app.state::<DbInstances>();
    let pools = instances.0.read().await;
    let Some(DbPool::Sqlite(pool)) = pools.get(&crate::db_url()) else {
        return Err("db_not_loaded".into());
    };
    run_batch(pool, statements).await.map_err(|e| e.to_string())
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
}

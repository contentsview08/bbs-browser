// LogStore を tauri-plugin-sql につなぐ。マイグレーションは Rust 側に登録してあり、load() のときに走る。
// 文を流すのは Rust の命令(sql_batch.rs)。plugin の execute・select は画面に許していない(別のファイルを開く文を断るため)
import Database from '@tauri-apps/plugin-sql'
import { invoke } from '@tauri-apps/api/core'
import { LogStore } from '@bbs-browser/logstore'

/** データの置き場(Rust の data_paths)。ZIP 版は展開したフォルダの data\、インストーラー版は %APPDATA% */
export interface DataPaths {
  /** Database.load() に渡す接続文字列(migration の鍵と同じもの) */
  db_url: string
  db: string
  backups: string
  portable: boolean
}
export const getDataPaths = () => invoke<DataPaths>('data_paths')

export async function openLogStore(): Promise<LogStore> {
  // DB の置き場は Rust が決める(ポータブルなら絶対パス)。URL は migration の登録と同じ文字列でないと走らない
  const { db_url } = await getDataPaths()
  await Database.load(db_url)
  return new LogStore({
    execute: async (sql, params) => {
      await invoke('sql_execute', { sql, params: params ?? [] })
    },
    select: <T,>(sql: string, params?: unknown[]) => invoke<T[]>('sql_select', { sql, params: params ?? [] }),
    // プラグインの execute はプールの別の接続へ行くことがあるので、トランザクションは Rust の命令で行う
    batch: (statements) => invoke('sql_batch', { statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })) }),
  })
}

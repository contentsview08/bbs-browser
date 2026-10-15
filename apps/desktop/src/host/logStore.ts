// LogStore を tauri-plugin-sql につなぐ。マイグレーションは Rust 側に登録してあり、load() のときに走る
import Database from '@tauri-apps/plugin-sql'
import { LogStore } from '@bbs-browser/logstore'

export async function openLogStore(): Promise<LogStore> {
  const db = await Database.load('sqlite:bbs-browser.db')
  return new LogStore({
    execute: async (sql, params) => {
      await db.execute(sql, params)
    },
    select: (sql, params) => db.select(sql, params),
  })
}

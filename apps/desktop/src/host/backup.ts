// バックアップのファイルを選んで読み書きする(ダイアログと Rust のコマンド)。中身を作る・確かめるのは utils/backup.ts

import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import type { LogStore } from '@bbs-browser/logstore'
import { backupFileName } from '../utils/backup'

/** JSON を書き出す。保存先を選ばなかったら false */
export async function saveJson(kind: 'settings' | 'ng', data: unknown): Promise<boolean> {
  const path = await save({ defaultPath: backupFileName(kind), filters: [{ name: 'JSON', extensions: ['json'] }] })
  if (!path) return false
  await invoke('write_json_file', { path, contents: JSON.stringify(data, null, 2) })
  return true
}

/** JSON を選んで読む。選ばなかったら undefined */
export async function openJson(): Promise<string | undefined> {
  const path = await open({ multiple: false, directory: false, filters: [{ name: 'JSON', extensions: ['json'] }] })
  if (typeof path !== 'string') return undefined
  return invoke<string>('read_json_file', { path })
}

/** ログ・設定・NG を含む DB 全体を書き出す。保存先を選ばなかったら false */
export async function backupDatabase(store: LogStore): Promise<boolean> {
  const path = await save({ defaultPath: backupFileName('db'), filters: [{ name: 'SQLite', extensions: ['db'] }] })
  if (!path) return false
  await invoke('prepare_db_backup', { path })
  await store.backupTo(path)
  return true
}

/** 書き出しておいた DB を選び、アプリを起動し直して入れ替える。選ばなかったら false(選べば戻ってこない) */
export async function restoreDatabase(): Promise<boolean> {
  const source = await open({ multiple: false, directory: false, filters: [{ name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3'] }] })
  if (typeof source !== 'string') return false
  await invoke('schedule_db_restore', { source })
  return true
}

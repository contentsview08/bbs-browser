// バックアップのファイルを選んで読み書きする(ダイアログと Rust のコマンド)。中身を作る・確かめるのは utils/backup.ts

import { invoke } from '@tauri-apps/api/core'
import { pickOpenPath, pickSavePath } from './dialog'
import { backupFileName } from '../utils/backup'

/** JSON を書き出す。保存先を選ばなかったら false */
export async function saveJson(kind: 'settings' | 'ng' | 'scheme', data: unknown): Promise<boolean> {
  const path = await pickSavePath(backupFileName(kind), 'JSON', ['json'])
  if (!path) return false
  await invoke('write_json_file', { path, contents: JSON.stringify(data, null, 2) })
  return true
}

/** JSON を選んで読む。選ばなかったら undefined */
export async function openJson(): Promise<string | undefined> {
  const path = await pickOpenPath('JSON', ['json'])
  if (!path) return undefined
  return invoke<string>('read_json_file', { path })
}

/** ログ・設定・NG を含む DB 全体と、書き込みの Cookie(認証の状態)を 1 つの ZIP に書き出す。保存先を選ばなかったら false */
export async function backupDatabase(): Promise<boolean> {
  const path = await pickSavePath(backupFileName('full'), 'まるごとバックアップ', ['zip'])
  if (!path) return false
  // 書き出しは Rust で行う(画面の SQL の口は VACUUM INTO を断る)
  await invoke('backup_db', { path })
  return true
}

/** はじめの状態に戻す。画像のキャッシュを消し、次の起動で DB(ログ・既読・お気に入り・設定・NG)をどけてまっさらで開く(戻ってこない) */
export async function factoryReset(): Promise<void> {
  await invoke('media_cache_clear').catch(() => undefined)
  try {
    localStorage.clear()
  } catch {
    // 使えない環境では何もしない
  }
  await invoke('schedule_factory_reset')
}

/** 書き出しておいた DB を選び、アプリを起動し直して入れ替える。選ばなかったら false(選べば戻ってこない) */
export async function restoreDatabase(): Promise<boolean> {
  // 新しい ZIP も、前の版の .db も戻せる
  const source = await pickOpenPath('まるごとバックアップ', ['zip', 'db', 'sqlite', 'sqlite3'])
  if (!source) return false
  await invoke('schedule_db_restore', { source })
  return true
}

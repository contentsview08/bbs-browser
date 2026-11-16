// ChMate のバックアップ(ZIP)を選んで、ほどいた中身を受け取る(Rust の chmate.rs)。意味づけは utils/chmate.ts
import { invoke } from '@tauri-apps/api/core'
import { pickOpenPath } from './dialog'
import type { ChmateRaw } from '../utils/chmate'

/** ZIP を選んで読む。選ばなかったら undefined */
export async function openChmateBackup(): Promise<ChmateRaw | undefined> {
  const path = await pickOpenPath('ChMate のバックアップ(ZIP)', ['zip'])
  if (!path) return undefined
  return invoke<ChmateRaw>('read_chmate_backup', { path })
}

// ChMate のバックアップ(ZIP)を選んで、ほどいた中身を受け取る(Rust の chmate.rs)。意味づけは utils/chmate.ts。
// 設定は別のウィンドウなので、選ぶのは設定のウィンドウ、読んで取り込むのはメイン(DB を持つ方)に分かれる。
// 選んだパスは Rust が覚えていて(chosen_paths)、どのウィンドウからでも 1 度だけ読める
import { invoke } from '@tauri-apps/api/core'
import { pickOpenPath } from './dialog'
import type { ChmateRaw } from '../utils/chmate'

/** ZIP を選ぶ。選ばなかったら undefined */
export const pickChmateBackup = (): Promise<string | undefined> => pickOpenPath('ChMate のバックアップ(ZIP)', ['zip'])

/** 選んだ ZIP をほどいて受け取る */
export const readChmateBackup = (path: string): Promise<ChmateRaw> => invoke<ChmateRaw>('read_chmate_backup', { path })

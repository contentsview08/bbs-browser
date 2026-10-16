// 保存・読み込みの画面(ダイアログ)。Rust 側で出し、選ばれたパスを Rust が覚える(chosen_paths.rs)。
// ファイルを読み書きする命令は、ここで選んだパスにしか使えない

import { invoke } from '@tauri-apps/api/core'

/** 保存先を選ぶ。選ばなかったら undefined */
export async function pickSavePath(defaultName: string, filterName: string, extensions: string[]): Promise<string | undefined> {
  return (await invoke<string | null>('pick_save_path', { defaultName, filterName, extensions })) ?? undefined
}

/** 読み込むファイルを選ぶ。選ばなかったら undefined */
export async function pickOpenPath(filterName: string, extensions: string[]): Promise<string | undefined> {
  return (await invoke<string | null>('pick_open_path', { filterName, extensions })) ?? undefined
}

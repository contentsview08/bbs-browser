// 背景画像。選んだ画像をアプリのデータフォルダにコピーし(Rust 側の set_background_image)、アセットとして読む

import { convertFileSrc, invoke } from '@tauri-apps/api/core'

/** 選んだ画像をコピーして、そのパスを返す(設定にはこのパスを保存する) */
export function importBackgroundImage(source: string): Promise<string> {
  return invoke<string>('set_background_image', { source })
}

/** 設定に残っているパスを、いまの置き場のものに読み替える(置き場が変わると、前のパスのままでは読めない) */
export function currentBackgroundImage(saved: string): Promise<string> {
  return invoke<string>('current_background_image', { saved })
}

/** 画面から読むための URL */
export function backgroundImageUrl(path: string): string {
  return convertFileSrc(path)
}

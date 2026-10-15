// 画像の保存(Rust 側の save_image)。取得から書き出しまで Rust で行い、保存したパスを返す

import { invoke } from '@tauri-apps/api/core'

/** dir が空ならダウンロードフォルダに保存する */
export function saveImage(url: string, dir: string): Promise<string> {
  return invoke<string>('save_image', { url, dir })
}

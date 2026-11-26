// 設定「埋め込みのブラウザで開く」: リンクをアプリのブラウザのウィンドウ(Rust の open_link_window。label "link")で開く。開いていれば同じ窓で開き直す
import { invoke } from '@tauri-apps/api/core'

export const openLinkWindow = (url: string) => invoke<void>('open_link_window', { url })

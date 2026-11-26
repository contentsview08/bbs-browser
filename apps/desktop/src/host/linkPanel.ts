// リンクのパネル(設定「リンクをアプリの中で開く」): 外のページを、画像ビューアーのように主の窓の上に重ねた子の webview で開く(Rust の link_panel.rs)。
// 枠の暗がり・上の帯は components/LinkPanelFrame が描き、その内側の位置と大きさ(CSS の px)をここから渡す
import { invoke } from '@tauri-apps/api/core'

export interface PanelRect {
  x: number
  y: number
  w: number
  h: number
}

export const openLinkPanel = (url: string, rect: PanelRect) => invoke<void>('open_link_panel', { url, rect })
export const moveLinkPanel = (rect: PanelRect) => invoke<void>('move_link_panel', { rect })
export const closeLinkPanel = () => invoke<void>('close_link_panel')
export const linkPanelUrl = () => invoke<string | null>('link_panel_url')

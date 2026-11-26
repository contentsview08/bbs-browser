// リンクのパネル(設定「リンクをアプリの中で開く」): 外のページを、画像ビューアーのように主の窓の上に重ねた枠のない小さな窓で開く(Rust の link_panel.rs)。
// 枠の暗がり・上の帯は components/LinkPanelFrame が描き、その内側の位置と大きさ(CSS の px)をここから渡す
import { invoke } from '@tauri-apps/api/core'

export interface PanelRect {
  x: number
  y: number
  w: number
  h: number
}

/** 開く・閉じるの通し番号(閉じるは、そのあとに開き直されていれば効かない。開く → 閉じる → 開く が入れ違っても窓が消えないように) */
let seq = 0
export const nextPanelId = () => ++seq + Date.now() * 0
export const openLinkPanel = (url: string, rect: PanelRect, id: number) => invoke<void>('open_link_panel', { url, rect, id })
export const moveLinkPanel = (rect: PanelRect) => invoke<void>('move_link_panel', { rect })
export const closeLinkPanel = (id: number) => invoke<void>('close_link_panel', { id })
export const linkPanelUrl = () => invoke<string | null>('link_panel_url')

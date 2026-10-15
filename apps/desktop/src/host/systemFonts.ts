// OS に入っているフォントの一覧(Rust 側の list_system_fonts)。一度取ったら覚えておく

import { invoke } from '@tauri-apps/api/core'

export interface SystemFont {
  /** CSS の font-family に書く名前 */
  family: string
  /** 日本語の名前があれば */
  localName?: string
  monospaced: boolean
}

let cache: Promise<SystemFont[]> | undefined

export function loadSystemFonts(): Promise<SystemFont[]> {
  cache ??= invoke<SystemFont[]>('list_system_fonts').catch((e: unknown) => {
    cache = undefined
    throw e
  })
  return cache
}

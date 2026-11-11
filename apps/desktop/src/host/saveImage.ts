// 画像の保存(Rust 側の save_image)。キャッシュにあれば通信せずに写し、なければ取って置いてから写す

import { invoke } from '@tauri-apps/api/core'
import { DEFAULT_SETTINGS } from '../ui/settings'

export interface SavedImage {
  path: string
  /** 通信せず、キャッシュから写した */
  fromCache: boolean
}

export interface MediaCacheUsage {
  bytes: number
  files: number
}

/** 保存のときに分かっているスレ */
export interface SaveThread {
  boardUrl: string
  key: string
  title: string
}

/** 保存先: 土台のフォルダ(空ならダウンロードフォルダ)と、その下の書き方(utils/saveName.ts)。スレの中の画像なら thread */
export interface SaveTo {
  dir: string
  pattern: string
  thread?: SaveThread
}

/** 設定を持たない画面の保存先(既定のまま) */
export const DEFAULT_SAVE_TO: SaveTo = { dir: DEFAULT_SETTINGS.imageSaveDir, pattern: DEFAULT_SETTINGS.imageSaveName }

/** Rust の save_name::SaveVars と同じ形 */
export interface SaveVars {
  boardUrl?: string
  site?: string
  board?: string
  thread?: string
  threadKey?: string
  no?: number
  /** 年・月・日・時・分・秒(この PC の時計) */
  time: number[]
  unix: number
}

/** 板の URL → 掲示板の名前・板の名前。DB と設定を持つ App が登録する */
type PlaceLookup = (boardUrl: string) => Promise<{ site?: string; board?: string }>
let placeLookup: PlaceLookup | undefined
export function setSavePlaceLookup(fn: PlaceLookup | undefined): void {
  placeLookup = fn
}

export function timeVars(d = new Date()): Pick<SaveVars, 'time' | 'unix'> {
  return {
    time: [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()],
    unix: Math.floor(d.getTime() / 1000),
  }
}

async function varsOf(to: SaveTo, no: number | undefined): Promise<SaveVars> {
  const t = to.thread
  if (!t) return { no, ...timeVars() }
  const place = (await placeLookup?.(t.boardUrl).catch(() => undefined)) ?? {}
  return { boardUrl: t.boardUrl, site: place.site, board: place.board, thread: t.title, threadKey: t.key, no, ...timeVars() }
}

/** 保存する。no はその画像の載っていたレスの番号(分かるとき) */
export async function saveImage(url: string, to: SaveTo, no?: number): Promise<SavedImage> {
  return invoke<SavedImage>('save_image', { url, dir: to.dir, pattern: to.pattern, vars: await varsOf(to, no) })
}

/** 設定の見本: 書き方から、土台の下のフォルダとファイル名を作る(最後がファイル名。ファイルは作らない) */
export function previewSavePath(pattern: string, url: string, ext: string, vars: SaveVars): Promise<string[]> {
  return invoke<string[]>('save_path_preview', { pattern, url, ext, vars })
}

/** キャッシュにあるか(urls と同じ並び) */
export function cachedImages(urls: string[]): Promise<boolean[]> {
  return invoke<boolean[]>('media_cached', { urls })
}

/** 取得を止める。img から src を外すだけでは Rust 側の通信は止まらない */
export function cancelImageFetch(url: string): void {
  void invoke('cancel_media', { url }).catch(() => undefined)
}

export function mediaCacheUsage(): Promise<MediaCacheUsage> {
  return invoke<MediaCacheUsage>('media_cache_usage')
}

export function clearMediaCache(): Promise<MediaCacheUsage> {
  return invoke<MediaCacheUsage>('media_cache_clear')
}

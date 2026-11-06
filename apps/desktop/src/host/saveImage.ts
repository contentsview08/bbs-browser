// 画像の保存(Rust 側の save_image)。キャッシュにあれば通信せずに写し、なければ取って置いてから写す

import { invoke } from '@tauri-apps/api/core'

export interface SavedImage {
  path: string
  /** 通信せず、キャッシュから写した */
  fromCache: boolean
}

export interface MediaCacheUsage {
  bytes: number
  files: number
}

/** dir が空ならダウンロードフォルダに保存する */
export function saveImage(url: string, dir: string): Promise<SavedImage> {
  return invoke<SavedImage>('save_image', { url, dir })
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

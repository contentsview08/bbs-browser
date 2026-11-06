// http の URL も先に https で取りに行き、取れなければ書いてあるとおり http に戻す。
// 掲示板に書かれる URL は http のままでも、今のサーバーは https だけのことが多い。https と書いてある URL は http に戻さない。スマホ版の data/HttpsFirst.kt と同じ考え方
// 画像はアプリのキャッシュ(Rust の media_cache.rs)を通し、同じ画像を二度取らない。https を先に試すのもそちらで行う

import { convertFileSrc, isTauri } from '@tauri-apps/api/core'
import { isAutoLoadable } from './safeUrl'

/** https で届かなかったホスト(毎回つながるのを待たない) */
const httpOnlyHosts = new Set<string>()
const fallbacks = new Map<string, string>()
const MAX_FALLBACKS = 5000

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

/** http の URL の https 版。http でない・https で届かないと分かっているホストは undefined */
export function toHttps(url: string): string | undefined {
  if (!/^http:\/\//i.test(url)) return undefined
  const host = hostOf(url)
  if (!host || httpOnlyHosts.has(host)) return undefined
  return `https://${url.slice('http://'.length)}`
}

/**
 * 通信を https から試す。例外か ok が false なら、http で取り直す。
 * 例外のときはそのホストを覚え、次から http で直接つなぐ
 */
export async function fetchHttpsFirst<T>(url: string, send: (url: string) => Promise<T>, ok: (res: T) => boolean): Promise<T> {
  const https = toHttps(url)
  if (!https) return send(url)
  try {
    const res = await send(https)
    if (ok(res)) return res
  } catch {
    const host = hostOf(url)
    if (host) httpOnlyHosts.add(host)
  }
  return send(url)
}

/** キャッシュが扱う形式に入らないもの(中身で見分けて保存するので、形式の分からないものは WebView に任せる) */
const NOT_CACHED = /\.(?:svg|ico)(?:[?#]|$)/i

/**
 * キャッシュを通すか。自動で読まないアドレスは、押して読むと決めたものも含めて通さない
 * (Rust 側も同じ判定で断る。キャッシュが読みに行ってよいのは自動で読めるアドレスだけ)
 */
export function usesMediaCache(url: string): boolean {
  return isAutoLoadable(url) && !NOT_CACHED.test(url)
}

/** <img> の src。アプリではキャッシュを通す */
export function mediaSrc(url: string): string
export function mediaSrc(url: string | undefined): string | undefined
export function mediaSrc(url: string | undefined): string | undefined {
  if (url && isTauri() && usesMediaCache(url)) return convertFileSrc(url, 'obb-media')
  return videoSrc(url)
}

/** <video> の src と、キャッシュを通さない <img> の src。読めなかったら、下の見張りが http に戻す */
export function videoSrc(url: string): string
export function videoSrc(url: string | undefined): string | undefined
export function videoSrc(url: string | undefined): string | undefined {
  if (!url) return url
  const https = toHttps(url)
  if (!https) return url
  if (fallbacks.size >= MAX_FALLBACKS) fallbacks.clear()
  fallbacks.set(https, url)
  return https
}

// error は親へ伝わらないので、画面全体を capture で見張る。戻すときは、部品の「読めなかった」の処理まで届かせない
if (typeof document !== 'undefined') {
  document.addEventListener(
    'error',
    (e) => {
      const el = e.target
      if (!(el instanceof HTMLImageElement || el instanceof HTMLVideoElement)) return
      const original = fallbacks.get(el.getAttribute('src') ?? '')
      if (!original) return
      e.stopPropagation()
      el.src = original
    },
    true,
  )
}

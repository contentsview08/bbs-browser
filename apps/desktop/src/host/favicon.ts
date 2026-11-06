// 板のファビコン。画像そのものを data: URL にして DB(favicons 表)に保存し、起動のたびに取りに行かないようにする。
// 自動で探すときは、板のページの HTML の指定(<link rel="icon">)、なければドメインの /favicon.ico。
// 保存してから 7 日たったら取り直す(取り直しに失敗したら、古いものを使い続ける)。

import { fetch } from '@tauri-apps/plugin-http'
import type { LogStore } from '@bbs-browser/logstore'
import { toBase64 } from '../utils/base64'
import { fetchHttpsFirst } from '../utils/httpsFirst'
import { BROWSER_LIKE_UA as USER_AGENT } from './userAgent'

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

let store: LogStore | undefined
/** DB を開いたら渡す(それまでは保存せずに取るだけ) */
export function initFavicons(s: LogStore) {
  store = s
}

/** アプリを閉じるまでの控え(同じ板を何度も DB に問い合わせないように) */
const memory = new Map<string, Promise<string | undefined>>()

/** <link rel="icon" href="..."> を探す(rel に icon を含むもの。apple-touch-icon は大きいので後回し) */
function iconFromHtml(html: string, pageUrl: string): string | undefined {
  const links = [...html.slice(0, 100_000).matchAll(/<link\b[^>]*>/gi)].map((m) => m[0])
  const pick = (re: RegExp) => links.find((l) => re.test(/rel\s*=\s*["']?([^"'>]+)/i.exec(l)?.[1] ?? ''))
  const tag = pick(/(^|\s)(shortcut\s+)?icon(\s|$)/i) ?? pick(/apple-touch-icon/i)
  const href = tag && /href\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]
  if (!href) return undefined
  try {
    return new URL(href, pageUrl).href
  } catch {
    return undefined
  }
}

/** 板のページを見て、ファビコンの URL を決める */
async function findIconUrl(boardUrl: string): Promise<string> {
  const fallback = new URL('/favicon.ico', boardUrl).href
  try {
    const res = await fetchHttpsFirst(boardUrl, (u) => fetch(u, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } }), (r) => r.ok)
    if (!res.ok || !/html/i.test(res.headers.get('content-type') ?? '')) return fallback
    return iconFromHtml(await res.text(), res.url || boardUrl) ?? fallback
  } catch {
    return fallback
  }
}

/** 画像を取って data: URL にする。画像でなければ undefined */
async function download(url: string): Promise<string | undefined> {
  const res = await fetchHttpsFirst(url, (u) => fetch(u, { headers: { 'User-Agent': USER_AGENT } }), (r) => r.ok)
  if (!res.ok) return undefined
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim() || 'image/x-icon'
  if (!type.startsWith('image/')) return undefined
  const bytes = new Uint8Array(await res.arrayBuffer())
  return bytes.length > 0 ? `data:${type};base64,${toBase64(bytes)}` : undefined
}

async function load(key: string, sourceUrl: () => Promise<string>): Promise<string | undefined> {
  const saved = await store?.getFavicon(key).catch(() => null)
  if (saved && Date.now() - saved.fetchedAt < MAX_AGE_MS) return saved.data
  try {
    const data = await download(await sourceUrl())
    if (data) {
      await store?.setFavicon(key, data).catch(() => undefined)
      return data
    }
  } catch {
    // 取れなかったら、古くても保存してあるものを使う
  }
  return saved?.data
}

/**
 * 板のファビコンを data: URL で返す。override(設定で上書きした画像の URL)があればそれを、なければ自動で探す。
 * どうしても取れなければ undefined
 */
export function faviconFor(boardUrl: string, override?: string): Promise<string | undefined> {
  const key = override ? `url:${override}` : boardUrl
  let p = memory.get(key)
  if (!p) {
    p = load(key, override ? async () => override : () => findIconUrl(boardUrl))
    memory.set(key, p)
  }
  return p
}

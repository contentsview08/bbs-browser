// 板のファビコンを探す。板のページの HTML に指定(<link rel="icon">)があればそれ、なければドメインの /favicon.ico。
// 一度探した板は覚えておく(アプリを閉じるまで)

import { fetch } from '@tauri-apps/plugin-http'

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) bbs-browser/0.1.0'

const cache = new Map<string, Promise<string>>()

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

async function detect(boardUrl: string): Promise<string> {
  const fallback = new URL('/favicon.ico', boardUrl).href
  try {
    const res = await fetch(boardUrl, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } })
    if (!res.ok || !/html/i.test(res.headers.get('content-type') ?? '')) return fallback
    return iconFromHtml(await res.text(), res.url || boardUrl) ?? fallback
  } catch {
    return fallback
  }
}

export function detectFavicon(boardUrl: string): Promise<string> {
  let p = cache.get(boardUrl)
  if (!p) {
    p = detect(boardUrl)
    cache.set(boardUrl, p)
  }
  return p
}

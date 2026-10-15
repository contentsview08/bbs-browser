// リンクの埋め込みのカード用に、ページを取ってきて OGP を読む。一度取ったものは覚えておく。
// web 版はサーバー側で取っていた(ブラウザからは別のサイトを読めないため)が、アプリは直接取りに行ける

import { fetch } from '@tauri-apps/plugin-http'
import { charsetOfHtml, parseOgp, type Ogp } from '../utils/ogp'

// 掲示板向けの Monazilla ではなく、ふつうのブラウザに近い名乗りにする(OGP を返さないサイトがあるため)
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) bbs-browser/0.1.0'

const cache = new Map<string, Promise<Ogp | null>>()

async function load(url: string): Promise<Ogp | null> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } })
  if (!res.ok) return null
  const type = res.headers.get('content-type') ?? ''
  if (!/html/i.test(type)) return null
  const bytes = new Uint8Array(await res.arrayBuffer())
  // 文字コードは、応答のヘッダー → ページの <meta charset> → UTF-8 の順に決める
  const fromHeader = /charset=([\w-]+)/i.exec(type)?.[1].toLowerCase()
  const peek = new TextDecoder('utf-8').decode(bytes.subarray(0, 4096))
  const charset = fromHeader ?? charsetOfHtml(peek) ?? 'utf-8'
  let html: string
  try {
    html = new TextDecoder(charset).decode(bytes)
  } catch {
    html = new TextDecoder('utf-8').decode(bytes)
  }
  const ogp = parseOgp(html, url)
  return ogp.title || ogp.description || ogp.image ? ogp : null
}

/** 取れなかったとき(HTML でない、何も書かれていない、通信に失敗した)は null */
export function fetchOgp(url: string): Promise<Ogp | null> {
  let p = cache.get(url)
  if (!p) {
    p = load(url).catch(() => null)
    cache.set(url, p)
  }
  return p
}

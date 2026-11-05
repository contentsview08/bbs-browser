// アプリの中でウェブページを読むための、本文の取り出し(リーダー表示)。
// ページをそのまま埋め込む(iframe)と、多くのサイトが埋め込みを断っているので表示できない。
// 代わりにページを取ってきて、題・サイト名・本文の段落・見出し・画像だけを抜き出し、アプリの見た目で出す。
// HTML をそのまま画面に入れることはしない(抜き出した文字と画像の URL だけを使う)
import { declaredCharset, detectEncoding, looksLikeUtf8 } from '@bbs-browser/connectors'

export type ReaderBlock =
  | { type: 'heading'; text: string }
  | { type: 'text'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'item'; text: string }
  | { type: 'code'; text: string }
  | { type: 'image'; src: string }

export interface ReaderPage {
  title: string
  site: string
  /** 代表の画像(og:image) */
  image?: string
  blocks: ReaderBlock[]
}

/** 本文として見ないもの */
const DROP = 'script, style, noscript, template, iframe, form, nav, header, footer, aside, svg, canvas, button, select, [aria-hidden="true"], [hidden]'
/** 文字の塊として読むもの(中には下りずに、まとめて 1 つにする) */
const TEXT_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'DT', 'DD', 'FIGCAPTION', 'TD'])
const MAX_BLOCKS = 600

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

/** 画像の本当の URL(遅延読み込みの data-src・srcset も見る) */
function imageSrc(img: Element, base: string): string | undefined {
  const raw =
    img.getAttribute('data-src') ||
    img.getAttribute('data-original') ||
    img.getAttribute('data-lazy-src') ||
    img.getAttribute('srcset')?.split(',')[0]?.trim().split(/\s+/)[0] ||
    img.getAttribute('src')
  if (!raw || raw.startsWith('data:')) return undefined
  try {
    const u = new URL(raw, base)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined
  } catch {
    return undefined
  }
}

/** 本文のありそうな要素: article・main、なければ段落の文字がいちばん多い要素 */
function pickRoot(doc: Document): Element {
  const explicit = doc.querySelector('article') ?? doc.querySelector('main') ?? doc.querySelector('[role="main"]')
  if (explicit && clean(explicit.textContent).length > 200) return explicit
  let best: Element = doc.body
  let bestScore = 0
  for (const el of doc.body.querySelectorAll('div, section')) {
    let score = 0
    for (const child of el.children) if (child.tagName === 'P') score += clean(child.textContent).length
    if (score > bestScore) {
      bestScore = score
      best = el
    }
  }
  return bestScore > 200 ? best : doc.body
}

export function extractPage(html: string, url: string): ReaderPage {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const meta = (name: string) =>
    doc.querySelector(`meta[property="${name}"]`)?.getAttribute('content') ?? doc.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? undefined
  const title = clean(meta('og:title') ?? doc.title) || url
  const site = clean(meta('og:site_name')) || new URL(url).hostname
  const ogImage = meta('og:image')
  let image: string | undefined
  try {
    image = ogImage ? new URL(ogImage, url).href : undefined
  } catch {
    image = undefined
  }
  for (const el of doc.querySelectorAll(DROP)) el.remove()

  const blocks: ReaderBlock[] = []
  const seenImages = new Set<string>()
  const pushImage = (img: Element) => {
    const w = Number(img.getAttribute('width') ?? 0)
    const h = Number(img.getAttribute('height') ?? 0)
    if ((w && w < 60) || (h && h < 60)) return // アイコン・飾り
    const src = imageSrc(img, url)
    if (src && !seenImages.has(src)) {
      seenImages.add(src)
      blocks.push({ type: 'image', src })
    }
  }
  const walk = (el: Element) => {
    if (blocks.length >= MAX_BLOCKS) return
    if (el.tagName === 'IMG') return pushImage(el)
    if (TEXT_TAGS.has(el.tagName)) {
      const text = el.tagName === 'PRE' ? (el.textContent ?? '').trim() : clean(el.textContent)
      if (text) {
        if (/^H[1-6]$/.test(el.tagName)) blocks.push({ type: 'heading', text })
        else if (el.tagName === 'LI') blocks.push({ type: 'item', text })
        else if (el.tagName === 'BLOCKQUOTE') blocks.push({ type: 'quote', text })
        else if (el.tagName === 'PRE') blocks.push({ type: 'code', text })
        else blocks.push({ type: 'text', text })
      }
      for (const img of el.querySelectorAll('img')) pushImage(img)
      return
    }
    // 子に段落がなく、文字だけが直接入っている div(ブログによくある)は、1 つの段落として読む
    const direct = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join('')
    if (clean(direct).length > 40 && el.children.length < 3) {
      blocks.push({ type: 'text', text: clean(el.textContent) })
      return
    }
    for (const child of el.children) walk(child)
  }
  walk(pickRoot(doc))
  // 本文の画像がなければ、代表の画像を頭に出す
  if (image && !blocks.some((b) => b.type === 'image')) blocks.unshift({ type: 'image', src: image })
  return { title, site, image, blocks }
}

const JAPANESE = /^(utf-?8|shift[-_]jis|x?-?sjis|ms932|cp932|windows-31j|x-ms-cp932|x?-?euc-?jp)$/

/**
 * 文字コードを見分けて文字にする。UTF-8 の形なら UTF-8、日本語以外の宣言(iso-8859-1 など)はそれに従い、
 * 残りは中身から決める(宣言が間違っているページ・書いていないページがある)
 */
export function decodeHtml(bytes: Uint8Array, contentType: string | undefined): string {
  const label = declaredCharset(bytes, contentType)
  if (label && !looksLikeUtf8(bytes) && !JAPANESE.test(label)) {
    try {
      return new TextDecoder(label).decode(bytes)
    } catch {
      // 知らない名前なら、中身から決める
    }
  }
  return new TextDecoder(detectEncoding(bytes, contentType, 'utf-8')).decode(bytes)
}

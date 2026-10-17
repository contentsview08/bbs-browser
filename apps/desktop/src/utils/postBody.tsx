// レス本文の解析と描画。本文はコネクタの段階でプレーンテキストになっているので、
// ここではアンカー(>>1)と URL だけを見つけて部品に分ける(HTML としては扱わない)。

import type { ReactNode } from 'react'
import { builtinConnectors, type Post } from '@bbs-browser/connectors'

/**
 * 同じ本文を何度も解析しないよう、結果を本文ごとに覚えておく(レスの描き直しやタブの作り直しのたびに解析しない)。
 * 多くなりすぎたら捨てて覚え直す
 */
function memoByText<T>(fn: (text: string) => T): (text: string) => T {
  const cache = new Map<string, T>()
  return (text) => {
    let v = cache.get(text)
    if (v === undefined) {
      if (cache.size > 20_000) cache.clear()
      v = fn(text)
      cache.set(text, v)
    }
    return v
  }
}

/** >>1, >>1-3, ＞＞1、URL(2ch 流の ttp:// も) */
// 本文の中の「ID:xxxx」(英数字や記号の並び)も拾い、押すとその ID のレスを出す(m[4])
const TOKEN = /(?:>>|＞＞)(\d{1,5})(?:-(\d{1,5}))?|(h?ttps?:\/\/[^\s<>"、。「」]+)|(?<![A-Za-z0-9])ID[:：]([!#-;=?-~]+)/g

/** 範囲アンカーは広げすぎない(>>1-1000 で全レスに数が付くのを防ぐ) */
const MAX_RANGE = 10

function expand(from: number, to: number | undefined): number[] {
  if (to === undefined || to < from || to - from >= MAX_RANGE) return [from]
  return Array.from({ length: to - from + 1 }, (_, i) => from + i)
}

export const anchorsIn = memoByText(function anchorsIn(text: string): number[] {
  const nums: number[] = []
  for (const m of text.matchAll(TOKEN)) {
    if (m[1]) nums.push(...expand(Number(m[1]), m[2] ? Number(m[2]) : undefined))
  }
  return nums
})

/** レス番号 → そのレスへのアンカーの数(自分自身へのアンカーは数えない) */
export function countAnchors(posts: Post[]): Map<number, number> {
  const counts = new Map<number, number>()
  for (const p of posts) {
    for (const n of new Set(anchorsIn(p.body))) {
      if (n !== p.no) counts.set(n, (counts.get(n) ?? 0) + 1)
    }
  }
  return counts
}

/** ID → そのスレでの書き込み数 */
export function countIds(posts: Post[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const p of posts) if (p.id) counts.set(p.id, (counts.get(p.id) ?? 0) + 1)
  return counts
}

/** 半角スペース・タブ・全角スペースが 5 つ以上続いていれば AA とみなす(web 版と同じ判定) */
export function looksLikeAA(text: string): boolean {
  return /[ \t　]{5,}/.test(text)
}

/** 書き込み数・被アンカー数の色(web 版の heatClass と同じ段階) */
export function heatClass(count: number): string {
  if (count >= 7) return 'text-c-heat-very-hot font-bold'
  if (count >= 5) return 'text-c-heat-hot font-bold'
  if (count >= 3) return 'text-c-heat-warm'
  return ''
}

/** 画像として扱う URL(拡張子で判定) */
const IMAGE_URL = /\.(?:jpe?g|png|gif|webp|avif)(?:[?#][^\s]*)?$/i

function normalizeUrl(raw: string): string {
  return raw.startsWith('ttp') ? `h${raw}` : raw
}

/**
 * 拡張子がなくても画像だと分かる(または画像に読み替えられる)サイトの決まり。
 * 読み替えた先が画像でなかったときは、サムネイルの読み込みに失敗して出ないだけなので、試しに読んでよい
 */
const IMAGE_RULES: { test: RegExp; to: (m: RegExpExecArray) => string }[] = [
  // imgur の画像ページ(imgur.com/abcd123)は、i.imgur.com/abcd123.jpg で画像そのものが取れる
  { test: /^https?:\/\/(?:i\.|m\.)?imgur\.com\/([A-Za-z0-9]{5,8})$/, to: (m) => `https://i.imgur.com/${m[1]}.jpg` },
  // X(Twitter)の画像は ?format=jpg のように拡張子を後ろに付ける
  { test: /^https?:\/\/pbs\.twimg\.com\/media\/[^?\s]+\?(?:.*&)?format=(?:jpg|jpeg|png|webp)/, to: (m) => m[0] },
]

/** 画像として出す URL に読み替える。画像でなければ undefined */
export function toImageUrl(url: string): string | undefined {
  if (IMAGE_URL.test(url)) return url
  for (const rule of IMAGE_RULES) {
    const m = rule.test.exec(url)
    if (m) return rule.to(m)
  }
  return undefined
}

export const imageUrlsIn = memoByText(function imageUrlsIn(text: string): string[] {
  const urls: string[] = []
  for (const m of text.matchAll(TOKEN)) {
    if (m[3]) {
      const img = toImageUrl(normalizeUrl(m[3]))
      if (img) urls.push(img)
    }
  }
  return urls
})

/** 動画のファイル(mp4 など)の URL。WebView でそのまま再生できる形式 */
const VIDEO_FILE_URL = /\.(?:mp4|m4v|webm|mov)(?:[?#][^\s]*)?$/i

export function isVideoFileUrl(url: string): boolean {
  return VIDEO_FILE_URL.test(url)
}

/** 本文の中の動画ファイルの URL(サムネイルを出し、押すとビューアーで再生する) */
export const videoFileUrlsIn = memoByText(function videoFileUrlsIn(text: string): string[] {
  const urls: string[] = []
  for (const m of text.matchAll(TOKEN)) {
    if (!m[3]) continue
    const url = normalizeUrl(m[3])
    if (isVideoFileUrl(url) && !urls.includes(url)) urls.push(url)
  }
  return urls
})

/** 画像でも動画でもないリンク(埋め込みのカードを出す候補) */
export const linkUrlsIn = memoByText(function linkUrlsIn(text: string): string[] {
  const urls: string[] = []
  for (const m of text.matchAll(TOKEN)) {
    if (!m[3]) continue
    const url = normalizeUrl(m[3])
    if (!toImageUrl(url) && !YOUTUBE_URL.test(url) && !isVideoFileUrl(url) && !urls.includes(url)) urls.push(url)
  }
  return urls
})

/** レスの見せ方の設定(スレ表示のオン・オフ) */
export interface DisplayOptions {
  /** 板の既定の名前(SETTING.TXT の BBS_NONAME_NAME) */
  nonameName?: string
  omitNoname: boolean
  collapseBlankLines: boolean
  trimTrailingBlank: boolean
  /**
   * 本文からアイコン(5ch の BE アイコンなど)を取り出す。掲示板ごとの書き方なので、コネクタが持っている。
   * 返す body はアイコンの部分を除いた本文
   */
  splitIcon?: (body: string) => { icon?: string; body: string }
}

/** 本文の見せ方: 3 行以上続く空行は 1 行にまとめ、文末の空行は消す */
export function displayBody(body: string, o: DisplayOptions): string {
  let s = body
  if (o.collapseBlankLines) s = s.replace(/\n[ \t\u3000]*(?:\n[ \t\u3000]*){3,}/g, '\n\n')
  if (o.trimTrailingBlank) s = s.replace(/[\s\u3000]+$/, '')
  return s
}

/** 名前の見せ方: 板の既定の名前で始まるなら、その部分を省く(後ろのトリップなどは残す) */
export function displayName(name: string, o: DisplayOptions): string {
  if (!o.omitNoname || !o.nonameName || !name.startsWith(o.nonameName)) return name
  return name.slice(o.nonameName.length).trim()
}

const YOUTUBE_URL = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch|shorts|live)|youtu\.be\/)/i

/** 本文の YouTube の動画(ID と元の URL)。サムネイルに使う */
export const youtubeLinksIn = memoByText(function youtubeLinksIn(text: string): { id: string; url: string }[] {
  const links: { id: string; url: string }[] = []
  for (const m of text.matchAll(TOKEN)) {
    if (!m[3]) continue
    const url = normalizeUrl(m[3])
    if (!YOUTUBE_URL.test(url)) continue
    const id = /(?:v=|youtu\.be\/|shorts\/|live\/)([\w-]{6,})/.exec(url)?.[1]
    if (id && !links.some((l) => l.id === id)) links.push({ id, url })
  }
  return links
})

/**
 * YouTube の URL を、埋め込みのプレーヤーの URL にする。YouTube でなければ undefined。
 * 再生を始める位置(t=90、t=1m30s、start=90)があれば、そこから再生する
 */
export function youtubeEmbedUrl(url: string): string | undefined {
  if (!YOUTUBE_URL.test(url)) return undefined
  const id = /(?:v=|youtu\.be\/|shorts\/|live\/)([\w-]{6,})/.exec(url)?.[1]
  if (!id) return undefined
  const t = /[?&#](?:t|start)=([\dhms]+)/.exec(url)?.[1]
  let start = 0
  if (t) {
    if (/^\d+$/.test(t)) start = Number(t)
    else for (const [, n, u] of t.matchAll(/(\d+)([hms])/g)) start += Number(n) * (u === 'h' ? 3600 : u === 'm' ? 60 : 1)
  }
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0${start > 0 ? `&start=${start}` : ''}`
}

/** 本文の YouTube の動画の ID(書き込み欄のサムネイルに使う) */
export function youtubeIdsIn(text: string): string[] {
  return youtubeLinksIn(text).map((l) => l.id)
}

/** 本文に YouTube の URL があるか(ミニマップの動画の印に使う) */
export function hasYoutube(text: string): boolean {
  for (const m of text.matchAll(TOKEN)) if (m[3] && YOUTUBE_URL.test(normalizeUrl(m[3]))) return true
  return false
}

/** 動画(YouTube か動画のファイル)を含むか。「動画」の絞り込みと縮図に使う */
export function hasVideo(text: string): boolean {
  return hasYoutube(text) || videoFileUrlsIn(text).length > 0
}

/** アプリ(専ブラ)で開けるスレの URL か。本文のリンクを緑にするのと、押したときにアプリで開くかの判断に使う */
export const isAppThreadUrl = memoByText((url) => builtinConnectors.some((c) => c.isThreadUrl?.(url) ?? false))

export interface BodyHandlers {
  /** アンカーを押した(via='click')、またはマウスを乗せた(via='hover') */
  onAnchor: (nos: number[], el: HTMLElement, via: 'click' | 'hover') => void
  /** アンカーからマウスが離れた(ホバーで開く前に離れたら取り消す) */
  onAnchorLeave?: () => void
  onUrl: (url: string) => void
  /** 本文の中の「ID:xxxx」を押した */
  onId?: (id: string, el: HTMLElement) => void
}

export function renderBody(text: string, handlers: BodyHandlers): ReactNode[] {
  const parts: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index
    if (start > last) parts.push(text.slice(last, start))
    if (m[1]) {
      const nos = expand(Number(m[1]), m[2] ? Number(m[2]) : undefined)
      parts.push(
        <span
          key={start}
          role="button"
          className="text-c-link hover:underline cursor-pointer"
          onClick={(e) => {
            e.stopPropagation()
            handlers.onAnchor(nos, e.currentTarget, 'click')
          }}
          onMouseEnter={(e) => handlers.onAnchor(nos, e.currentTarget, 'hover')}
          onMouseLeave={handlers.onAnchorLeave}
        >
          {m[0]}
        </span>,
      )
    } else if (m[4]) {
      const id = m[4]
      parts.push(
        <span
          key={start}
          role="button"
          className="text-c-link hover:underline cursor-pointer"
          onClick={(e) => {
            e.stopPropagation()
            handlers.onId?.(id, e.currentTarget)
          }}
        >
          {m[0]}
        </span>,
      )
    } else {
      const url = normalizeUrl(m[3])
      parts.push(
        <a
          key={start}
          href={url}
          className={`hover:underline break-all ${
            toImageUrl(url) ? 'text-c-link-image' : YOUTUBE_URL.test(url) ? 'text-[#ff3344]' : isAppThreadUrl(url) ? 'text-mark-new' : 'text-c-link'
          }`}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            handlers.onUrl(url)
          }}
        >
          {m[0]}
        </a>,
      )
    }
    last = start + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

/**
 * アンカーツリー: start からアンカーを前後(付けた先・付けられた元)にたどって、つながるレスの番号を全部集める。
 * web 版の buildAnchorTree と同じ。start だけなら長さ 1 になる
 */
export function anchorTree(start: number, posts: Post[]): number[] {
  const exists = new Set(posts.map((p) => p.no))
  const to = new Map<number, number[]>()
  const from = new Map<number, number[]>()
  for (const p of posts) {
    const nums = anchorsIn(p.body).filter((n) => exists.has(n) && n !== p.no)
    to.set(p.no, nums)
    for (const n of nums) from.set(n, [...(from.get(n) ?? []), p.no])
  }
  const seen = new Set([start])
  const queue = [start]
  while (queue.length > 0) {
    const cur = queue.shift()!
    for (const n of [...(to.get(cur) ?? []), ...(from.get(cur) ?? [])]) {
      if (!seen.has(n)) {
        seen.add(n)
        queue.push(n)
      }
    }
  }
  return [...seen].sort((a, b) => a - b)
}

/** リンク(画像・動画以外の URL)があるか */
export function hasLink(text: string): boolean {
  return linkUrlsIn(text).length > 0
}

/** 検索用に揃える: 全角半角(NFKC)・大文字小文字・カタカナとひらがなの違いを無視する */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
}

/** ツリー表示の 1 行 */
export interface TreeRow {
  no: number
  depth: number
  /** 親より上の段ごとに、縦線を下まで続けるか(その段にまだ兄弟が残っているか) */
  rails: boolean[]
  /** 兄弟の中で最後か(最後なら └、そうでなければ ├) */
  last: boolean
  /** 親のほかにもアンカーを付けている先 */
  alsoTo: number[]
}

/**
 * アンカーツリーを、線でつないで描くための行の並びにする。
 * 親は「自分がアンカーを付けた先のうち、いちばん前のレス」。どこにも付けていないレスが根になる。
 * 前にあるレスにしか親を取らないので、輪にはならない
 */
export function anchorTreeRows(start: number, posts: Post[]): TreeRow[] {
  const nos = anchorTree(start, posts)
  const inTree = new Set(nos)
  const byNo = new Map(posts.map((p) => [p.no, p]))
  const parent = new Map<number, number>()
  const alsoTo = new Map<number, number[]>()
  const children = new Map<number, number[]>()
  for (const no of nos) {
    const targets = [...new Set(anchorsIn(byNo.get(no)?.body ?? ''))].filter((n) => inTree.has(n) && n < no).sort((a, b) => a - b)
    if (targets.length === 0) continue
    parent.set(no, targets[0])
    alsoTo.set(no, targets.slice(1))
    children.set(targets[0], [...(children.get(targets[0]) ?? []), no])
  }

  const rows: TreeRow[] = []
  const walk = (no: number, depth: number, rails: boolean[], last: boolean) => {
    rows.push({ no, depth, rails, last, alsoTo: alsoTo.get(no) ?? [] })
    const kids = (children.get(no) ?? []).sort((a, b) => a - b)
    kids.forEach((k, i) => walk(k, depth + 1, depth === 0 ? [] : [...rails, !last], i === kids.length - 1))
  }
  const roots = nos.filter((n) => !parent.has(n))
  roots.forEach((r, i) => walk(r, 0, [], i === roots.length - 1))
  return rows
}

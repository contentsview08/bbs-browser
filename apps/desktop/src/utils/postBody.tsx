// レス本文の解析と描画。本文はコネクタの段階でプレーンテキストになっているので、
// ここではアンカー(>>1)と URL だけを見つけて部品に分ける(HTML としては扱わない)。

import type { ReactNode } from 'react'
import type { Post } from '@bbs-browser/connectors'

/** >>1, >>1-3, ＞＞1、URL(2ch 流の ttp:// も) */
const TOKEN = /(?:>>|＞＞)(\d{1,5})(?:-(\d{1,5}))?|(h?ttps?:\/\/[^\s<>"、。「」]+)/g

/** 範囲アンカーは広げすぎない(>>1-1000 で全レスに数が付くのを防ぐ) */
const MAX_RANGE = 10

function expand(from: number, to: number | undefined): number[] {
  if (to === undefined || to < from || to - from >= MAX_RANGE) return [from]
  return Array.from({ length: to - from + 1 }, (_, i) => from + i)
}

export function anchorsIn(text: string): number[] {
  const nums: number[] = []
  for (const m of text.matchAll(TOKEN)) {
    if (m[1]) nums.push(...expand(Number(m[1]), m[2] ? Number(m[2]) : undefined))
  }
  return nums
}

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

export function imageUrlsIn(text: string): string[] {
  const urls: string[] = []
  for (const m of text.matchAll(TOKEN)) {
    if (m[3]) {
      const url = normalizeUrl(m[3])
      if (IMAGE_URL.test(url)) urls.push(url)
    }
  }
  return urls
}

const YOUTUBE_URL = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch|shorts|live)|youtu\.be\/)/i

/** 本文に YouTube の URL があるか(ミニマップの動画の印に使う) */
export function hasYoutube(text: string): boolean {
  for (const m of text.matchAll(TOKEN)) if (m[3] && YOUTUBE_URL.test(normalizeUrl(m[3]))) return true
  return false
}

export interface BodyHandlers {
  /** アンカーを押した(via='click')、またはマウスを乗せた(via='hover') */
  onAnchor: (nos: number[], el: HTMLElement, via: 'click' | 'hover') => void
  /** アンカーからマウスが離れた(ホバーで開く前に離れたら取り消す) */
  onAnchorLeave?: () => void
  onUrl: (url: string) => void
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
    } else {
      const url = normalizeUrl(m[3])
      parts.push(
        <a
          key={start}
          href={url}
          className={`hover:underline break-all ${IMAGE_URL.test(url) ? 'text-c-link-image' : 'text-c-link'}`}
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

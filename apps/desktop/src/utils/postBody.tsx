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
// URL は見えない文字(ゼロ幅スペース、U+2060 のワードジョイナーなど)で切る。URL の直後に入れて書かれることがある。
// アンカーは >>1 のほか、>1、>>1-3、>>1,2,5、>>1-3,8 も拾う(m[1] に番号の並びが入る)。
// 番号は 10 桁まで拾う(4chan などは板全体の通し番号)。どのレスを指すかは AnchorResolver で決める(2ch は 5 桁まで)。
// > 1 つのものは、「2>1」のような式を拾わないよう、前が英数字や記号のときは除く。
// 本文の中の「ID:xxxx」(英数字や記号の並び)も拾い、押すとその ID のレスを出す(m[3])
const TOKEN = /(?:>>|＞＞|(?<![\w>＞=-])[>＞])(\d{1,10}(?:-\d{1,10})?(?:[,，]\d{1,10}(?:-\d{1,10})?)*)(?!\d)|(h?ttps?:\/\/[^\s<>"、。「」\u200b-\u200f\u2060-\u2064\ufeff]+)|(?<![A-Za-z0-9])ID[:：]([!#-;=?-~]+)/g

/** 範囲アンカーは広げすぎない(>>1-1000 で全レスに数が付くのを防ぐ) */
const MAX_RANGE = 10

function expand(from: number, to: number | undefined): number[] {
  if (to === undefined || to < from || to - from >= MAX_RANGE) return [from]
  return Array.from({ length: to - from + 1 }, (_, i) => from + i)
}

/** 1 つのアンカーで指せる数の上限(>>1,2,3,… と並べすぎたもの) */
const MAX_LIST = 30

/** アンカーの番号の並び("98-100,105")を、番号の一覧にする */
function expandList(list: string): number[] {
  const nos: number[] = []
  for (const part of list.split(/[,，]/)) {
    const [from, to] = part.split('-')
    for (const n of expand(Number(from), to ? Number(to) : undefined)) if (!nos.includes(n)) nos.push(n)
  }
  return nos.slice(0, MAX_LIST)
}

export const anchorsIn = memoByText(function anchorsIn(text: string): number[] {
  const nums: number[] = []
  for (const m of text.matchAll(TOKEN)) {
    if (m[1]) nums.push(...expandList(m[1]))
  }
  return nums
})

/**
 * アンカーの番号を、スレの中のレス(Post.no)に読み替えるもの。指すレスがなければ undefined。
 * 掲示板ごとに違う: 2ch はアンカーの番号がそのまま no(5 桁まで)、4chan などは板の本当の番号(Post.ref)
 */
export type AnchorResolver = (n: number) => number | undefined

/** 2ch など: アンカーの番号がそのままスレの中の番号。6 桁以上は、昔からアンカーとして扱わない */
export const sameNo: AnchorResolver = (n) => (n <= 99999 ? n : undefined)

/** スレのレスから、アンカーの読み替えを作る。target が 'ref' なら板の本当の番号(Post.ref)から no へ */
export function makeAnchorResolver(posts: Post[], target: 'no' | 'ref' = 'no'): AnchorResolver {
  if (target !== 'ref') return sameNo
  const map = new Map<number, number>()
  for (const p of posts) if (p.ref !== undefined) map.set(p.ref, p.no)
  return (n) => map.get(n)
}

/** 本文のアンカーが指すレスの番号(no)。読み替えられないものは除く */
export function anchorTargets(text: string, resolve: AnchorResolver = sameNo): number[] {
  const out: number[] = []
  for (const n of anchorsIn(text)) {
    const no = resolve(n)
    if (no !== undefined) out.push(no)
  }
  return out
}

/**
 * 文章で引用する掲示板(ふたば)の、引用元のつながり。レス番号 → (引用した行の文章 → 引用元のレス番号)。
 * 「>前のレスの文章」の行ごとに、それより前のレスを新しい方から見て、その文章を含むレス(または画像のファイル名)を探す。
 * 「>>前のレスの引用」は、前のレスの引用の行(「>前のレスの文章」)を含むレスにつなぐ
 */
export type QuoteLinks = Map<number, Map<string, number>>

/** 引用の行(「>」で始まり、アンカー(>12)だけの行ではないもの)なら、引用した文章 */
export function quotedText(line: string): string | undefined {
  const m = /^[>＞](.+)$/.exec(line.trim())
  if (!m || /^[>＞]?\d+$/.test(m[1].trim())) return undefined
  return m[1].trim() || undefined
}

export function quoteLinksOf(posts: Post[]): QuoteLinks {
  const out: QuoteLinks = new Map()
  const lines = posts.map((p) => p.body.split('\n').map((l) => l.trim()))
  for (let i = 0; i < posts.length; i++) {
    let links: Map<string, number> | undefined
    for (const line of lines[i]) {
      const q = quotedText(line)
      if (!q || links?.has(line)) continue
      // まずは、引用の行ではない所にその文があるレス(書いた本人)を探す。同じ文を引用しただけのレスにつながないように。
      // 見つからなければ(「>>」で引用の引用をしている など)、引用の行も含めて探す
      const find = (ownTextOnly: boolean) => {
        for (let j = i - 1; j >= 0; j--) {
          const hit = lines[j].some(
            (l) =>
              (ownTextOnly ? quotedText(l) === undefined : true) &&
              // 画像のファイル名の引用(「>1792224836232.jpg」)は、その画像を貼ったレス
              (l.includes(q) || (/^https?:\/\//.test(l) && l.endsWith(`/${q}`))),
          )
          if (hit) return posts[j].no
        }
        return undefined
      }
      const src = find(true) ?? find(false)
      if (src !== undefined) (links ??= new Map()).set(line, src)
    }
    if (links) out.set(posts[i].no, links)
  }
  return out
}

/** レスが指すレスの番号(アンカーと、文章の引用の元)。重ならないようにまとめる */
export function targetsOfPost(p: Post, resolve: AnchorResolver = sameNo, quotes?: QuoteLinks): number[] {
  const nums = anchorTargets(p.body, resolve)
  const q = quotes?.get(p.no)
  return q ? [...new Set([...nums, ...q.values()])] : nums
}

/** レス番号 → そのレスへのアンカーの数(自分自身へのアンカーは数えない) */
export function countAnchors(posts: Post[], resolve: AnchorResolver = sameNo, quotes?: QuoteLinks): Map<number, number> {
  const counts = new Map<number, number>()
  for (const p of posts) {
    for (const n of new Set(targetsOfPost(p, resolve, quotes))) {
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
    if (m[2]) {
      const img = toImageUrl(normalizeUrl(m[2]))
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
    if (!m[2]) continue
    const url = normalizeUrl(m[2])
    if (isVideoFileUrl(url) && !urls.includes(url)) urls.push(url)
  }
  return urls
})

/** 画像でも動画でもないリンク(埋め込みのカードを出す候補) */
export const linkUrlsIn = memoByText(function linkUrlsIn(text: string): string[] {
  const urls: string[] = []
  for (const m of text.matchAll(TOKEN)) {
    if (!m[2]) continue
    const url = normalizeUrl(m[2])
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
    if (!m[2]) continue
    const url = normalizeUrl(m[2])
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
  for (const m of text.matchAll(TOKEN)) if (m[2] && YOUTUBE_URL.test(normalizeUrl(m[2]))) return true
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
  /** アンカーの番号をスレの中の番号に読み替える(なければ 2ch と同じ)。どのレスも指さないアンカーは、ただの文字にする */
  toNo?: AnchorResolver
}

/**
 * 本文を描く。quotes があれば(文章で引用する掲示板)、「>文章」の行を緑の引用にし、引用元が分かれば押せるようにする
 * (押す・乗せると、アンカーと同じく引用元をポップアップで出す)
 */
export function renderBody(text: string, handlers: BodyHandlers, quotes?: Map<string, number>): ReactNode[] {
  if (!quotes) return renderTokens(text, handlers, '')
  const parts: ReactNode[] = []
  text.split('\n').forEach((line, i) => {
    if (i > 0) parts.push('\n')
    if (quotedText(line) === undefined) return void parts.push(...renderTokens(line, handlers, `${i}:`))
    const no = quotes.get(line.trim())
    parts.push(
      no === undefined ? (
        <span key={`q${i}`} className="text-mark-new">
          {line}
        </span>
      ) : (
        <span
          key={`q${i}`}
          role="button"
          tabIndex={0}
          className="text-mark-new hover:underline cursor-pointer"
          title={`引用元のレスを出す`}
          onClick={(e) => {
            e.stopPropagation()
            handlers.onAnchor([no], e.currentTarget, 'click')
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            e.stopPropagation()
            handlers.onAnchor([no], e.currentTarget, 'click')
          }}
          onMouseEnter={(e) => handlers.onAnchor([no], e.currentTarget, 'hover')}
          onMouseLeave={handlers.onAnchorLeave}
        >
          {line}
        </span>
      ),
    )
  })
  return parts
}

function renderTokens(text: string, handlers: BodyHandlers, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index
    if (start > last) parts.push(text.slice(last, start))
    if (m[1]) {
      const resolve = handlers.toNo ?? sameNo
      const nos = expandList(m[1]).map(resolve).filter((n): n is number => n !== undefined)
      if (nos.length === 0) {
        parts.push(m[0])
        last = start + m[0].length
        continue
      }
      parts.push(
        <span
          key={keyPrefix + start}
          role="button"
          tabIndex={0}
          className="text-c-link hover:underline cursor-pointer"
          onClick={(e) => {
            e.stopPropagation()
            handlers.onAnchor(nos, e.currentTarget, 'click')
          }}
          onKeyDown={(e) => {
            // Tab で選んだアンカーは、Enter で開く(押したのと同じ)
            if (e.key !== 'Enter') return
            e.preventDefault()
            e.stopPropagation()
            handlers.onAnchor(nos, e.currentTarget, 'click')
          }}
          onMouseEnter={(e) => handlers.onAnchor(nos, e.currentTarget, 'hover')}
          onMouseLeave={handlers.onAnchorLeave}
        >
          {m[0]}
        </span>,
      )
    } else if (m[3]) {
      const id = m[3]
      parts.push(
        <span
          key={keyPrefix + start}
          role="button"
          tabIndex={0}
          className="text-c-link hover:underline cursor-pointer"
          onClick={(e) => {
            e.stopPropagation()
            handlers.onId?.(id, e.currentTarget)
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            e.stopPropagation()
            handlers.onId?.(id, e.currentTarget)
          }}
        >
          {m[0]}
        </span>,
      )
    } else {
      const url = normalizeUrl(m[2])
      parts.push(
        <a
          key={keyPrefix + start}
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
export function anchorTree(start: number, posts: Post[], resolve: AnchorResolver = sameNo, quotes?: QuoteLinks): number[] {
  const exists = new Set(posts.map((p) => p.no))
  const to = new Map<number, number[]>()
  const from = new Map<number, number[]>()
  for (const p of posts) {
    const nums = targetsOfPost(p, resolve, quotes).filter((n) => exists.has(n) && n !== p.no)
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
export function anchorTreeRows(start: number, posts: Post[], resolve: AnchorResolver = sameNo, quotes?: QuoteLinks): TreeRow[] {
  const nos = anchorTree(start, posts, resolve, quotes)
  const inTree = new Set(nos)
  const byNo = new Map(posts.map((p) => [p.no, p]))
  const parent = new Map<number, number>()
  const alsoTo = new Map<number, number[]>()
  const children = new Map<number, number[]>()
  for (const no of nos) {
    const p = byNo.get(no)
    const targets = (p ? targetsOfPost(p, resolve, quotes) : []).filter((n) => inTree.has(n) && n < no).sort((a, b) => a - b)
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

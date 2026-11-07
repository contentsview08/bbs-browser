// スレ表示のスクロールで「どこへ動かすか・どこまで読んだか」を決める計算。
// 画面(DOM)には触らず、測った値を受け取って答えだけを返す。動かすのは hooks/useThreadScroll.ts。
// ここを分けておくのは、開く・読む・タブを切り替える・新着が届く、の流れをテストで確かめるため。

import type { Post } from '@bbs-browser/connectors'
import type { OpenPosition } from '../ui/settings'
import { cardUrlsIn, looksLikeAA, mediaIn } from './postBody'
import { isAutoLoadable } from './safeUrl'

/** 読んでいた位置。画面のいちばん上に見えていたレスと、ヘッダーの下端からのずれ */
export interface ScrollPosition {
  no: number
  offset: number
  /** 一番下まで見ていた。戻すときはレスの位置ではなく一番下へ戻す(レスの高さの見積もりでずれないように) */
  bottom?: boolean
}

/** 開いたときの行き先 */
export type OpenTarget =
  | { kind: 'saved'; position: ScrollPosition; pendingUnread?: boolean }
  | { kind: 'bottom'; pendingUnread: boolean }
  | { kind: 'unread'; no: number }
  | { kind: 'top' }

/**
 * 開いたとき(最初にレスが出たとき)にどこへ置くか。
 * タブを切り替えて戻ってきたときの位置があればそれを優先し、なければ設定どおりにする。
 * 「最初の未読」がまだ手元にない(前回最後まで読んでいた)ときは、閉じたときの位置があればそこ、なければ一番下に置いて新着を待つ
 */
export function openTarget(input: {
  saved?: ScrollPosition
  /** saved のレスが画面にあるか */
  savedFound: boolean
  /** タブを閉じたときに読んでいた位置。全部読み終えたスレは未読の頭がないので、この位置へ戻す */
  closed?: ScrollPosition
  openPosition: OpenPosition
  unreadFrom: number
  /** unreadFrom のレスが手元のログにあるか */
  hasUnreadPost: boolean
}): OpenTarget {
  const { saved } = input
  if (saved?.bottom) return { kind: 'bottom', pendingUnread: false }
  if (saved && input.savedFound) return { kind: 'saved', position: saved }
  if (input.openPosition === 'bottom') return { kind: 'bottom', pendingUnread: false }
  if (input.openPosition === 'unread' && input.unreadFrom > 1) {
    if (input.hasUnreadPost) return { kind: 'unread', no: input.unreadFrom }
    const closed = input.closed
    return closed && !closed.bottom ? { kind: 'saved', position: closed, pendingUnread: true } : { kind: 'bottom', pendingUnread: true }
  }
  return { kind: 'top' }
}

/** 新着が届いたときの行き先。動かさないなら undefined */
export type NewPostsTarget = { no: number; animate: boolean } | { bottom: true; animate: boolean } | undefined

/**
 * 新着が届いたときに、どこへ動かすか。
 * - 開いたときに未読の頭がまだなかった(pendingUnread)なら、届いた未読の頭へすぐ移る
 * - 開いて最初の取得の分で、利用者がまだ触っていなければ、それまでを読み終えていたときだけ新着の頭へすぐ移る
 *   (位置が一番下から少しずれていても送る。前の位置からもう一度動いて見せると遅く感じるため)
 * - 読んでいる途中は、設定がオンで一番下を見ているときだけ、新着の頭へ動かして見せる
 */
export function newPostsTarget(input: {
  pendingUnread: boolean
  unreadFrom: number
  hasUnreadPost: boolean
  /** 届く前の最後のレス番号 */
  prevLastNo: number
  /** 既読にしたレス番号 */
  readNo: number
  /** 開いてから最初に届いた新着で、利用者がまだスレ表示を触っていない */
  opening: boolean
  autoScrollOnNew: boolean
  atBottom: boolean
}): NewPostsTarget {
  if (input.pendingUnread && input.hasUnreadPost) return { no: input.unreadFrom, animate: false }
  const head = input.prevLastNo + 1
  if (input.opening) return input.readNo >= input.prevLastNo ? { no: head, animate: false } : undefined
  if (!input.autoScrollOnNew || !input.atBottom) return undefined
  return { no: head, animate: true }
}

/** 既読の判定に使う、レス 1 件ぶんの枠の位置(スクロール領域の画面上の座標) */
export interface PostRect {
  no: number
  top: number
  bottom: number
  /** 絞り込みで隠しているレス */
  hidden: boolean
  /** まだ中身を作っていない(仮の高さの箱)。高さは覚えない */
  placeholder?: boolean
}

/**
 * どこまで読んだかと、読んでいた位置を求める。
 * - 画面の下端より上に頭が出ているレスのうち、いちばん後ろの番号を既読にする
 * - 一番下まで来ていれば、絞り込みや NG で隠れているレスも含めて全部読んだことにする
 * - ヘッダーの下に少しでも見えている最初のレスを、読んでいた位置として覚える
 */
export function readProgress(input: {
  rects: Iterable<PostRect>
  viewTop: number
  viewBottom: number
  atBottom: boolean
  lastNo: number
}): { last: number; position?: ScrollPosition } {
  let last = 0
  let top: { no: number; offset: number } | undefined
  for (const r of input.rects) {
    if (r.hidden) continue
    if (r.top >= input.viewBottom) break
    last = r.no
    if (!top && r.bottom > input.viewTop) top = { no: r.no, offset: r.top - input.viewTop }
  }
  if (input.atBottom) last = Math.max(last, input.lastNo)
  return { last, position: top && { ...top, bottom: input.atBottom } }
}

/**
 * 新着を若い番号から順に出すときの、1 件ごとの遅れ(ms)。
 * 1 件ごとに step ずつずらし、件数が多いときは全体で total に収まるよう詰める
 */
export function staggerDelays(nos: number[], step = 35, total = 450): Map<number, number> {
  const d = Math.min(step, total / Math.max(1, nos.length - 1))
  return new Map(nos.map((no, i) => [no, Math.round(i * d)]))
}

/** レスの高さの見積もりに使う、画面の寸法 */
export interface HeightMetrics {
  /** 本文 1 行に入る文字数(全角で数える) */
  charsPerLine: number
  lineHeight: number
  /** 名前・日付の行と、レスどうしの余白 */
  chrome: number
  /** 画像・動画のサムネイルの段(1 段ぶんの高さと、段の上の余白) */
  thumbRow: number
  /** リンクのプレビュー 1 件(札の高さと、札の上の余白) */
  linkPreview: number
  showThumbnails: boolean
  /** リンクの札を出すか */
  showLinkPreview?: boolean
  /** サムネイルが 1 段に何個並ぶか(決めなければ折り返さない) */
  thumbsPerRow?: number
}

/**
 * まだ描いていないレスの高さを、本文から見積もる(content-visibility の仮の大きさに使う)。
 * 一律の値にすると、長いレスや画像の多いスレで飛び先や前の位置への戻しがずれるため
 */
export function estimatePostHeight(post: Post, m: HeightMetrics): number {
  // AA は折り返さずに出す
  const wraps = !looksLikeAA(post.body)
  let lines = 0
  for (const line of post.body.split('\n')) {
    if (!wraps) {
      lines++
      continue
    }
    // 半角は全角の半分の幅として数える
    let w = 0
    for (const ch of line) w += ch.charCodeAt(0) < 0x80 ? 0.5 : 1
    lines += Math.max(1, Math.ceil(w / Math.max(1, m.charsPerLine)))
  }
  let h = m.chrome + lines * m.lineHeight
  const { media, links } = postShape(post, m)
  if (media > 0) h += m.thumbRow * Math.ceil(media / Math.max(1, m.thumbsPerRow ?? media))
  h += links * m.linkPreview
  return Math.round(h)
}

/** レスの中で、本文のほかに高さを決めるもの。サムネイルの数と、リンクの札の数(札は 3 件まで。PostArticle と同じ) */
export function postShape(post: Post, m: Pick<HeightMetrics, 'showThumbnails' | 'showLinkPreview'>): { media: number; links: number } {
  return {
    media: m.showThumbnails ? mediaIn(post.body).length : 0,
    links: m.showLinkPreview ? Math.min(3, cardUrlsIn(post.body).filter(isAutoLoadable).length) : 0,
  }
}

/** 見積もりと実測の差を種類ごとに分けるための名前。頭の省略・サムネイル・札の有無で、見積もりの外れ方が違う */
export function heightKind(flags: { continued?: boolean; media?: boolean; links?: boolean }): string {
  return `${flags.continued ? 'c' : ''}${flags.media ? 'm' : ''}${flags.links ? 'l' : ''}`
}

/**
 * 実測の差(実際の高さ − 見積もり)から、種類ごとの補正を求める。中央値なので、飛び抜けて高いレスには引きずられない。
 * 数の少ない種類は、全体の中央値を使う
 */
export function heightOffsets(samples: readonly { kind: string; diff: number }[], minPerKind = 3): { all: number; byKind: Map<string, number> } {
  const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1]
  const groups = new Map<string, number[]>()
  for (const s of samples) {
    const g = groups.get(s.kind)
    if (g) g.push(s.diff)
    else groups.set(s.kind, [s.diff])
  }
  const byKind = new Map<string, number>()
  for (const [kind, g] of groups) if (g.length >= minPerKind) byKind.set(kind, median(g))
  return { all: samples.length ? median(samples.map((s) => s.diff)) : 0, byKind }
}

/** 基準のレスをそのまま見せるために scrollTop へ足す量。位置は「画面上の位置 + scrollTop」(スクロールしても変わらない値)で比べる */
export function anchorCorrection(savedY: number, nowY: number): number {
  const d = nowY - savedY
  // 小数の丸めで直し続けないよう、0.5px 未満は直さない
  return Math.abs(d) < 0.5 ? 0 : d
}

/**
 * ジャンプのあとに直し続けるのをやめるか。行き先が quietMs のあいだ動かなければ着いたものとし、
 * 動き続けても maxMs で打ち切る(読み込みが終わらないときに、利用者のスクロールを奪い続けないように)
 */
export function settleDone(t: { now: number; start: number; lastChange: number }, quietMs: number, maxMs: number): boolean {
  return t.now - t.lastChange >= quietMs || t.now - t.start >= maxMs
}

/**
 * ジャンプの途中で、自分ではない誰かが動かしたか(ミニマップ・指の慣性など)。
 * 中身が縮んで一番下に押し戻されたときは、誰かが動かしたことにしない
 */
export function movedByOthers(scrollTop: number, written: number, maxScrollTop: number): boolean {
  if (Number.isNaN(written) || Math.abs(scrollTop - written) < 2) return false
  return !(written > maxScrollTop && Math.abs(scrollTop - maxScrollTop) < 2)
}

/** 読んでいた位置を、スレごとに少しだけ覚えておく入れ物。多すぎたら古いものから捨てる */
export class PositionMemory {
  private map = new Map<string, ScrollPosition>()
  constructor(private limit = 200) {}
  get(thread: string): ScrollPosition | undefined {
    return this.map.get(thread)
  }
  set(thread: string, pos: ScrollPosition) {
    this.map.delete(thread)
    this.map.set(thread, pos)
    while (this.map.size > this.limit) this.map.delete(this.map.keys().next().value!)
  }
  delete(thread: string) {
    this.map.delete(thread)
  }
}

/**
 * 描いたことのあるレスの高さを覚えておく。スレ表示を作り直したとき(残しておくタブから外れて戻ったとき)にも、
 * 見積もりではなく前に測った高さを仮の大きさに使えるように、スレをまたいで持つ。
 * 幅が変わると高さも変わるので、幅ごとに分ける(幅は 10px 単位に丸める)
 */
export class HeightCache {
  private map = new Map<string, number>()
  constructor(private limit = 20000) {}

  private key(thread: string, width: number, no: number) {
    return `${thread}\n${Math.round(width / 10)}\n${no}`
  }

  get(thread: string, width: number, no: number): number | undefined {
    return this.map.get(this.key(thread, width, no))
  }

  set(thread: string, width: number, no: number, height: number) {
    const k = this.key(thread, width, no)
    this.map.delete(k)
    this.map.set(k, height)
    // 古いものから捨てる(Map は入れた順に並ぶ)
    while (this.map.size > this.limit) this.map.delete(this.map.keys().next().value!)
  }

  get size() {
    return this.map.size
  }
}

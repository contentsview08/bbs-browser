// スレ表示のスクロールで「どこへ動かすか・どこまで読んだか」を決める計算。
// 画面(DOM)には触らず、測った値を受け取って答えだけを返す。動かすのは hooks/useThreadScroll.ts。
// ここを分けておくのは、開く・読む・タブを切り替える・新着が届く、の流れをテストで確かめるため。

import type { Post } from '@bbs-browser/connectors'
import { imageUrlsIn, youtubeIdsIn } from './postBody'

/** 読んでいた位置。画面のいちばん上に見えていたレスと、ヘッダーの下端からのずれ */
export interface ScrollPosition {
  no: number
  offset: number
  /** 一番下まで見ていた。戻すときはレスの位置ではなく一番下へ戻す(レスの高さの見積もりでずれないように) */
  bottom?: boolean
}

export type OpenPosition = 'unread' | 'top' | 'bottom'

/** 開いたときの行き先 */
export type OpenTarget =
  | { kind: 'saved'; position: ScrollPosition }
  | { kind: 'bottom'; pendingUnread: boolean }
  | { kind: 'unread'; no: number }
  | { kind: 'top' }

/**
 * 開いたとき(最初にレスが出たとき)にどこへ置くか。
 * タブを切り替えて戻ってきたときの位置があればそれを優先し、なければ設定どおりにする。
 * 「最初の未読」がまだ手元にない(前回最後まで読んでいた)ときは、一番下に置いて新着を待つ
 */
export function openTarget(input: {
  saved?: ScrollPosition
  /** saved のレスが画面にあるか */
  savedFound: boolean
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
    return input.hasUnreadPost ? { kind: 'unread', no: input.unreadFrom } : { kind: 'bottom', pendingUnread: true }
  }
  return { kind: 'top' }
}

/** 新着が届いたときの行き先。動かさないなら undefined */
export type NewPostsTarget = { no: number; animate: boolean } | undefined

/**
 * 新着が届いたときに、どこへ動かすか。
 * - 開いたときに未読の頭がまだなかった(pendingUnread)なら、届いた未読の頭へすぐ移る
 * - 開いて最初の取得の分で、本人がまだ触っていなければ、それまでを読み終えていたときだけ新着の頭へすぐ移る
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
  /** 開いてから最初に届いた新着で、本人がまだスレ表示を触っていない */
  opening: boolean
  autoScrollOnNew: boolean
  atBottom: boolean
}): NewPostsTarget {
  if (input.pendingUnread && input.hasUnreadPost) return { no: input.unreadFrom, animate: false }
  const head = input.prevLastNo + 1
  if (input.opening) return input.readNo >= input.prevLastNo ? { no: head, animate: false } : undefined
  return input.autoScrollOnNew && input.atBottom ? { no: head, animate: true } : undefined
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
  /** 画像・動画のサムネイルの段 */
  thumbRow: number
  /** リンクのプレビュー 1 件 */
  linkPreview: number
  showThumbnails: boolean
}

/**
 * まだ描いていないレスの高さを、本文から見積もる(content-visibility の仮の大きさに使う)。
 * 一律の値にすると、長いレスや画像の多いスレで飛び先や前の位置への戻しがずれるため
 */
export function estimatePostHeight(post: Post, m: HeightMetrics): number {
  let lines = 0
  for (const line of post.body.split('\n')) {
    // 半角は全角の半分の幅として数える
    let w = 0
    for (const ch of line) w += ch.charCodeAt(0) < 0x80 ? 0.5 : 1
    lines += Math.max(1, Math.ceil(w / Math.max(1, m.charsPerLine)))
  }
  let h = m.chrome + lines * m.lineHeight
  if (m.showThumbnails && (imageUrlsIn(post.body).length > 0 || youtubeIdsIn(post.body).length > 0)) h += m.thumbRow
  return Math.round(h)
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

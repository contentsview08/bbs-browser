// スレ表示のスクロールで「どこへ動かすか・どこまで読んだか」を決める計算。
// 画面(DOM)には触らず、測った値を受け取って答えだけを返す。動かすのは hooks/useThreadScroll.ts。
// ここを分けておくのは、開く・読む・タブを切り替える・新着が届く、の流れをテストで確かめるため。

import type { Post } from '@bbs-browser/connectors'
import type { OpenPosition } from '../ui/settings'
import { cardUrlsIn, looksLikeAA, mediaIn, shortUrl, toImageUrl, type UrlDisplay } from './postBody'
import { isAutoLoadable } from './safeUrl'

/** 読んでいた位置。画面のいちばん上に見えていたレスと、ヘッダーの下端からのずれ */
export interface ScrollPosition {
  no: number
  offset: number
  /** 一番下まで見ていた。戻すときはレスの位置ではなく一番下へ戻す(レスの高さの見積もりでずれないように) */
  bottom?: boolean
  /** 覚えたときの既読。開き直すときに、同期で既読が先へ進んだかを見分ける(古い覚えには無い) */
  readNo?: number
}

/** 開いたときの行き先 */
export type OpenTarget =
  | { kind: 'saved'; position: ScrollPosition; pendingUnread?: boolean }
  | { kind: 'bottom'; pendingUnread: boolean }
  | { kind: 'unread'; no: number }
  | { kind: 'top' }

/**
 * 開いたとき(最初にレスが出たとき)にどこへ置くか。
 * - 覚えた位置(タブを切り替えて戻ってきたとき)があっても、覚えたときの既読より今の既読が先(別の端末で読み進めた分が同期で届いた)なら使わず、既読の次へ
 * - 覚えた位置のレスが画面にあればそこへ(一番下で閉じたなら一番下)。ログを取り直して見つからなければ、覚えた位置は使わない
 * - 覚えた位置が使えなければ設定どおり。「最初の未読」がまだ手元にない(前回最後まで読んでいた)ときは、
 *   閉じたときの位置(これも既読が進んでいれば使わない)があればそこ、なければ一番下に置いて新着を待つ
 * - 既読が 0 で覚えた位置もなければ先頭
 * 覚えた位置の no は画面の上に見えていたレスなので、既読そのものとは比べない(既読は 1 画面ぶん先にある)。既読を添えていない古い覚えはそのまま使う
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
  /** 今の既読(省くと unreadFrom - 1) */
  readNo?: number
}): OpenTarget {
  const readNo = input.readNo ?? input.unreadFrom - 1
  const usable = (p?: ScrollPosition) => (p && !(p.readNo !== undefined && readNo > p.readNo) ? p : undefined)
  const saved = usable(input.saved)
  if (saved?.bottom) return { kind: 'bottom', pendingUnread: false }
  if (saved && input.savedFound) return { kind: 'saved', position: saved }
  if (input.openPosition === 'bottom') return { kind: 'bottom', pendingUnread: false }
  if (input.openPosition === 'unread' && input.unreadFrom > 1) {
    if (input.hasUnreadPost) return { kind: 'unread', no: input.unreadFrom }
    const closed = usable(input.closed)
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
  // 同期で既読が届いた分より先へ進んでいれば、新着の頭はその次
  const head = Math.max(input.prevLastNo, input.readNo) + 1

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
 * - 画面の下端より上に頭が出ているレスのうち、いちばん大きい番号を既読にする(番号の順の表示。ツリーは treeRead で決める)
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
    last = Math.max(last, r.no)
    if (!top && r.bottom > input.viewTop) top = { no: r.no, offset: r.top - input.viewTop }
  }
  if (input.atBottom) last = Math.max(last, input.lastNo)
  return { last, position: top && { ...top, bottom: input.atBottom } }
}

/**
 * ツリー表示の既読。番号の順のレス(nos)を若い方から見て、既読(readNo まで)か画面に出したもの(seen)が途切れずに続く最後の番号。
 * 後ろの番号の返信が先に見えても、その前のレスを出し終えるまでは既読を飛ばさない
 */
export function contiguousRead(nos: readonly number[], readNo: number, seen: ReadonlySet<number>): number {
  let last = readNo
  for (const no of nos) {
    if (no <= readNo) continue
    if (!seen.has(no)) break
    last = no
  }
  return last
}

/**
 * ツリー表示でどこまで読んだか。
 * - 途中で止まっているときは、1 番から途切れずに出し終えた所まで(contiguousRead。後ろの返信が先に見えても飛ばさない)
 * - 一番下まで来ていれば(-END- が見えた)、番号の順の表示と同じく、ミニマップや End で飛ばして出していないレスがあっても lastNo まで。
 *   途中の既読が止まったまま一番下に着くと、タブ・スレ一覧の未読の数が消えなかった。
 *   1 画面に収まる短いスレは、開いただけで一番下にいるので全部既読になる
 */
export function treeRead(input: { nos: readonly number[]; readNo: number; seen: ReadonlySet<number>; atBottom: boolean; lastNo: number }): number {
  const head = contiguousRead(input.nos, input.readNo, input.seen)
  return input.atBottom ? Math.max(head, input.lastNo) : head
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
  /** AA の行の高さ(AA 用の字は行の間が詰まる。省くと lineHeight) */
  aaLineHeight?: number
  /** URL の見せ方(短く出す・画像の URL を札にする)。本文に出る字の数が変わるので、折り返しの数に効く */
  urls?: UrlDisplay
}

/** 本文の URL。描くとき(postBody の TOKEN)より粗いが、長さを数えるにはこれで足りる */
const URL_IN_BODY = /h?ttps?:\/\/[^\s<>"'）)」]+/gi

/**
 * 描いたときの本文(URL の見せ方を当てたもの)。字の数を数えるためのもので、描く部品(postBody の renderTokens)と同じ決まりで、
 * URL は設定どおり短く(shortUrl)、画像の URL は札(「画像」+ アイコン)にし、空白・改行だけを挟んで続いた画像は 1 つの札にまとめる
 * (改行をまたいでまとまるので、画像の URL を 1 行ずつ並べたレスは行数が減る)
 */
export function displayText(body: string, urls?: UrlDisplay): string {
  if (!urls) return body
  let out = ''
  let last = 0
  let prevImageEnd = -1
  for (const m of body.matchAll(URL_IN_BODY)) {
    const u = m[0]
    const at = m.index
    const image = (urls.omitImages || urls.collapseImageRuns) && toImageUrl(u) !== undefined
    if (image && prevImageEnd >= 0 && urls.collapseImageRuns && body.slice(prevImageEnd, at).trim() === '') {
      // 前の画像の札に「ほか n 件」としてまとまる(間の空白・改行ごと)
      prevImageEnd = at + u.length
      last = prevImageEnd
      continue
    }
    out += body.slice(last, at)
    if (image) {
      out += urls.omitImages ? '画像　' : `${shortUrl(u)}　`
      prevImageEnd = at + u.length
    } else {
      out += urls.shorten ? shortUrl(u) : u
      prevImageEnd = -1
    }
    last = at + u.length
  }
  return out + body.slice(last)
}

/** 1 行の字の数(全角で数える。半角は半分)。URL の見せ方は displayText で当ててから渡す */
export function displayUnits(line: string, urls?: UrlDisplay): number {
  let w = 0
  for (const ch of urls ? displayText(line, urls) : line) w += ch.charCodeAt(0) < 0x80 ? 0.5 : 1
  return w
}

/**
 * まだ描いていないレスの高さを、本文から見積もる(content-visibility の仮の大きさに使う)。
 * 一律の値にすると、長いレスや画像の多いスレで飛び先や前の位置への戻しがずれるため
 */
export function estimatePostHeight(post: Post, m: HeightMetrics, body = post.body): number {
  // AA は折り返さず、AA 用の字(行の間が詰まる)で出す
  const aa = looksLikeAA(body)
  let lines = 0
  for (const line of displayText(body, m.urls).split('\n')) {
    if (aa) {
      lines++
      continue
    }
    lines += Math.max(1, Math.ceil(displayUnits(line) / Math.max(1, m.charsPerLine)))
  }
  let h = m.chrome + lines * (aa ? (m.aaLineHeight ?? m.lineHeight) : m.lineHeight)
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
 * 基準のレスを元の位置に戻すための scrollTop。直さなくてよければ undefined。
 * 上のレスが縮んで中身が短くなると、ブラウザが先に scrollTop を一番下まで詰める(clamp)。そのうえで縮んだ分を引くと二重に戻ってしまうので、
 * 「詰められた」(基準を覚えたときの scrollTop より小さく、かつ一番下にいる)ときは、覚えたときの scrollTop を元に直す
 */
export function anchorShift(saved: { y: number; scrollTop: number }, now: { y: number; scrollTop: number; maxScrollTop: number }): number | undefined {
  const d = anchorCorrection(saved.y, now.y)
  if (d === 0) return undefined
  const clamped = now.scrollTop < saved.scrollTop && now.scrollTop >= now.maxScrollTop - 1
  const base = clamped ? saved.scrollTop : now.scrollTop
  return Math.max(0, Math.min(now.maxScrollTop, base + d))
}

/**
 * レスへ飛ぶときの、レスの頭を置く位置(スクロール領域の上端から)。
 * 見える範囲(ヘッダーの下)の縦の真ん中にレスの真ん中が来るように。レスが見える範囲より高ければ、頭をヘッダーの下に置く
 */
export function centerOffset(viewHeight: number, postHeight: number, headerHeight = 0): number {
  const visible = Math.max(0, viewHeight - headerHeight)
  return headerHeight + Math.max(0, (visible - postHeight) / 2)
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

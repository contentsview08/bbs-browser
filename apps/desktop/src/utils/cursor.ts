// 選んでいるもの(スレ表示のレス・スレ一覧のスレ・ポップアップのレス)の決め方。
// 画面の大きさや位置は呼ぶ側が測って渡し、ここでは「どれを選ぶか」「どれだけ送るか」だけを決める(テストできるように)

/** J・K で選んだものへ送るときのスクロールの時間と、画面の上下に残す余白の割合 */
export const CURSOR_SCROLL_MS = 160
export const CURSOR_MARGIN = 0.25
/** Esc の 2 回押しとみなす間隔 */
export const DOUBLE_ESC_MS = 500

/** 縦の位置(画面の座標) */
export interface Span {
  top: number
  bottom: number
}

/** 要素の縦の位置(画面の座標) */
export function spanOf(el: HTMLElement): Span {
  const r = el.getBoundingClientRect()
  return { top: r.top, bottom: r.bottom }
}

/** 見えている範囲。top はヘッダーの下 */
export type View = Span

/** 選んでいるものが、画面から大きく(1 画面分以上)離れていないか。押し続けて送るのが追いついていないだけなら近いとみなす */
export function isNear(item: Span, view: View): boolean {
  const room = view.bottom - view.top
  return item.bottom > view.top - room && item.top < view.bottom + room
}

/**
 * 上から順に並んだ count 個のうち、posOf(i) が y より大きい最初のものの位置。なければ count。半分ずつ探す。
 * posOf が undefined を返すものは隠れているものとして飛ばす(測らずに済むので、隠れた枠が多くても測る回数は増えない)
 */
export function firstAfter(count: number, posOf: (i: number) => number | undefined, y: number): number {
  let lo = 0
  let hi = count
  let found = count
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    let i = mid
    let pos = posOf(i)
    while (pos === undefined && ++i < hi) pos = posOf(i)
    if (pos === undefined) hi = mid
    else if (pos > y) {
      found = i
      hi = mid
    } else lo = i + 1
  }
  return found
}

/** 枠の中で、その番号の枠の位置(番号の順なら半分ずつ探す)。なければ -1 */
export function frameIndexOf(frames: readonly HTMLElement[], no: number): number {
  const i = firstAfter(frames.length, (k) => Number(frames[k].dataset.post), no - 0.5)
  if (i < frames.length && Number(frames[i].dataset.post) === no) return i
  // ツリー表示は番号の順に並ばないので、半分ずつ探して外れたら端から探す
  return frames.findIndex((f) => Number(f.dataset.post) === no)
}

/** 少しでも見えているか(端の 4px は見えていないとみなす) */
export function isSeen(item: Span, view: View): boolean {
  return item.bottom > view.top + 4 && item.top < view.bottom - 4
}

export interface StepInput {
  /** 並んでいる数 */
  count: number
  /** いま選んでいるものの位置。なければ -1 */
  current: number
  /** 選んでいるものが見えているか、近いか */
  onScreen: boolean
  /** Esc 2 回で印を隠しているか */
  hidden: boolean
  /** 進む向き(J・↓ は 1、K・↑ は -1) */
  d: 1 | -1
  /** 見えているものの位置(上から順) */
  seen: number[]
  /** まだ選んでいないときに J で始める位置(「ここから未読」のレス)。なければ undefined */
  startAt?: number
}

/**
 * J・K で次に選ぶもの。'stay' は動かさない(隠していた印を出し直すだけ)。
 * - 隠していたら、最初の 1 回は動かさずに出し直す(画面から離れていたら選び直す)
 * - 選んでいるものが画面にあれば、その次・前(端で止まる)
 * - 画面から離れていたら、見えている所から選び直す(J は一番上、K は一番下)。新着の頭があればそこから
 */
export function stepCursor(s: StepInput): number | 'stay' | undefined {
  if (s.count === 0) return undefined
  if (s.hidden && s.current >= 0 && s.onScreen) return 'stay'
  if (s.current >= 0 && s.onScreen) return Math.min(s.count - 1, Math.max(0, s.current + s.d))
  if (s.startAt !== undefined) return s.startAt
  return (s.d > 0 ? s.seen[0] : s.seen.at(-1)) ?? 0
}

/**
 * 選んだものが画面の外に出そうなときに送る量(正なら下へ)。送らなくてよければ 0。
 * 進む向きの側だけ、画面の高さの margin の割合だけ余白を残して早めに送る(vim の scrolloff)。
 * 画面より高いものは、頭をヘッダーのすぐ下(4px 空けて)に合わせる
 */
export function followDelta(item: Span, view: View, d: 1 | -1, margin = 0.25): number {
  const room = view.bottom - view.top
  const height = item.bottom - item.top
  if (height > room) return item.top - view.top - 4
  const m = Math.min(room * margin, Math.max(0, room - height) / 2)
  const topLimit = view.top + (d < 0 ? m : 0)
  const bottomLimit = view.bottom - (d > 0 ? m : 0)
  if (item.top < topLimit) return item.top - topLimit
  if (item.bottom > bottomLimit) return item.bottom - bottomLimit
  return 0
}

/**
 * 1 画面・半画面送ったあとに選ぶもの。送る前に選んでいたものの高さ y を保ち、送った量 moved だけずらした所にあるもの。
 * 送れなかった(端だった)ら端のもの。items は送る前の位置
 */
export function pickAfterPage(items: Span[], y: number, moved: number, dir: 1 | -1): number | undefined {
  return pickAfterPageAt(items.length, (i) => items[i], y, moved, dir)
}

/** pickAfterPage の、位置を測りながら選ぶ形。spanAt は送る前の位置を返す(上から順に並んでいるので、全部は測らない) */
export function pickAfterPageAt(count: number, spanAt: (i: number) => Span, y: number, moved: number, dir: 1 | -1): number | undefined {
  if (count === 0) return undefined
  const edge = dir > 0 ? count - 1 : 0
  if (moved === 0) return edge
  const at = y + moved
  const i = firstAfter(count, (k) => spanAt(k).bottom, at)
  return i < count && spanAt(i).top <= at ? i : edge
}

/** 2 回押し(Esc を素早く 2 回)とみなすか */
export function isDoublePress(last: number, now: number, ms: number): boolean {
  return now - last < ms
}

/**
 * 新着が届いた・開き直した(「ここから未読」が変わった)ときに、選んでいるレスを残すか。
 * 読んだところの最後(一番下まで読んでいた)なら残し、それより前なら忘れる(次の J は新着の頭から)
 */
export function keepCursorOnNew(cursor: number | undefined, unreadFrom: number): number | undefined {
  return cursor !== undefined && cursor >= unreadFrom - 1 ? cursor : undefined
}

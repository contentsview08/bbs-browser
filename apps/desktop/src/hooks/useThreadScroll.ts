// スレ表示のスクロールまわりをまとめたもの。
// - 開いたら設定どおりの位置(最初の未読/先頭/末尾、タブを切り替えて戻ったときは前の位置)へ置く
// - スクロールや中身の変化に合わせて、どこまで読んだかを知らせ、読んでいた位置を覚える
// - 新着が届いたら光らせ、若い番号から順に出し、必要なら新着の頭まで送る
// - 一番下へ飛ぶボタンを出すかどうか
// - まだ描いていないレスの仮の高さ(描いたことがあれば覚えておいた高さ、なければ本文から見積もった高さ)
// どこへ動かすか・どこまで読んだかの判断は utils/threadScroll.ts(テストあり)に任せ、ここでは測って動かすだけにする。

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { Post } from '@bbs-browser/connectors'
import type { ThreadLog } from '@bbs-browser/logstore'
import {
  HeightCache,
  estimatePostHeight,
  newPostsTarget,
  openTarget,
  readProgress,
  staggerDelays,
  type OpenPosition,
  type PostRect,
  type ScrollPosition,
} from '../utils/threadScroll'

/** 未読の頭を置く位置(見えている範囲の上からの割合)。上の 3 割には既読のレスを残す */
const UNREAD_AT = 0.3
/** 一番下からこれだけ以内なら「いちばん下を見ている」とみなす(新着を追いかける) */
const BOTTOM_PX = 80
/** 一番下へ飛ぶのにかける時間 */
const JUMP_MS = 300
/** 着いたあと、行き先がこれだけ動かなくなるまで追いかける(画面の外で省いていたレスが描かれて高さが変わるため) */
const SETTLE_MS = 250
/** 追いかけるのは長くてもここまで */
const FOLLOW_MAX_MS = 1500
/** レスへ飛んだあと、そのレスを画面の同じ位置に留めておく時間(サムネイル・リンクのプレビューが読み込まれて高さが変わるため) */
const PIN_MS = 8000
/** 新着を光らせておく時間(app.css の .flash-new の長さと揃える) */
const FLASH_MS = 1000
/** 新着を若い番号から順に出すときの 1 件ごとのずらしと、全体の長さの上限(app.css の .post-enter) */
const STAGGER_MS = 35
const STAGGER_TOTAL_MS = 450
/** キー操作で動かすときの時間 */
const STEP_MS = 120
/** 1 画面ぶん送るとき、前の画面と重ねて残す高さ */
const PAGE_OVERLAP_PX = 48
/** スクロールが止まってから既読を知らせるまでの待ち */
const READ_DELAY_MS = 300

/** 描いたことのあるレスの高さ。タブを作り直しても使えるよう、スレ表示の外に置く */
const heights = new HeightCache()

/** スクロール領域ごとの、いま動かしている(留めている)のをやめる関数。新しく動かすときに前のをやめる */
const moving = new WeakMap<HTMLElement, () => void>()

/**
 * 決めた時間で、素早く(終わりだけゆっくり)スクロールする。ms が 0 ならその場で移る。
 * ブラウザのなめらかなスクロールは、距離が長いと遅く、途中で別のスクロールに割り込まれると止まるので使わない。
 * 行き先は関数で受け取り、動いている間に中身が増えても、毎回その時点の行き先へ向かう。
 * 着いたあとも、画面の外で省いていたレス(.post-cv)が本当の高さで描かれて行き先がずれるので、
 * 行き先が SETTLE_MS 動かなくなるまで追いかける。そのあいだにホイールやクリック、キーを押したらやめる。
 * 同じ領域で別の動きを始めたら、前の動きはやめる(開いたときに一番下を追いかけている間に新着が届き、
 * 未読の頭へ動かすと、2 つが引っぱり合って一番下までガクガク送られていた)
 */
export function animateScroll(root: HTMLElement, target: () => number, ms = JUMP_MS) {
  moving.get(root)?.()
  const clamped = () => Math.max(0, Math.min(target(), root.scrollHeight - root.clientHeight))
  const from = root.scrollTop
  const start = performance.now()
  let stopped = false
  const stop = () => {
    stopped = true
    root.removeEventListener('wheel', stop)
    root.removeEventListener('pointerdown', stop)
    window.removeEventListener('keydown', stop)
    if (moving.get(root) === stop) moving.delete(root)
  }
  moving.set(root, stop)
  root.addEventListener('wheel', stop, { passive: true })
  root.addEventListener('pointerdown', stop)
  window.addEventListener('keydown', stop)
  if (ms <= 0) root.scrollTop = clamped()
  let last = NaN
  let stableSince = start
  const step = (now: number) => {
    if (stopped) return
    const to = clamped()
    const t = ms <= 0 ? 1 : Math.min(1, (now - start) / ms)
    root.scrollTop = t < 1 ? from + (to - from) * (1 - (1 - t) ** 3) : to
    if (t >= 1 && Math.abs(to - last) >= 1) {
      last = to
      stableSince = now
    }
    if (t < 1 || (now - stableSince < SETTLE_MS && now - start < FOLLOW_MAX_MS)) requestAnimationFrame(step)
    else stop()
  }
  requestAnimationFrame(step)
}

/**
 * 行き先へすぐ移り、そのあとも中身の高さが変わるたびに(サムネイル・リンクのプレビューが読み込まれた、
 * 画面の外で省いていたレスが本当の高さで描かれた)行き先へ合わせ直す。描く前(ResizeObserver の中)に合わせるので、
 * 別の所が一瞬見えることもない。
 * 本人がスクロールしたら(ホイール・キー・スワイプ・スクロールバー・ミニマップ)やめる。レスを押しただけではやめない
 */
export function pinScroll(root: HTMLElement, target: () => number, ms = PIN_MS) {
  moving.get(root)?.()
  const apply = () => {
    const to = Math.max(0, Math.min(target(), root.scrollHeight - root.clientHeight))
    if (Math.abs(root.scrollTop - to) >= 1) root.scrollTop = to
  }
  apply()
  const observer = new ResizeObserver(apply)
  for (const child of root.children) observer.observe(child)
  // スクロールバー(スクロール領域そのもの)と、領域の外(ミニマップなど)を押したらやめる
  const onPointer = (e: PointerEvent) => {
    if (e.target === root || !(e.target instanceof Node && root.contains(e.target))) stop()
  }
  const timer = setTimeout(() => stop(), ms)
  const stop = () => {
    observer.disconnect()
    clearTimeout(timer)
    root.removeEventListener('wheel', stop)
    root.removeEventListener('touchstart', stop)
    window.removeEventListener('keydown', stop)
    window.removeEventListener('pointerdown', onPointer, true)
    if (moving.get(root) === stop) moving.delete(root)
  }
  root.addEventListener('wheel', stop, { passive: true })
  root.addEventListener('touchstart', stop, { passive: true })
  window.addEventListener('keydown', stop)
  window.addEventListener('pointerdown', onPointer, true)
  moving.set(root, stop)
}

/** レスを包む枠(.post-cv)。番号は枠に持たせてある(NG で中身を描かないレスも数えるため) */
function postFrames(root: HTMLElement): NodeListOf<HTMLElement> {
  return root.querySelectorAll<HTMLElement>(':scope .post-cv')
}

interface Options {
  /** スクロールする領域 */
  rootRef: RefObject<HTMLDivElement | null>
  /** レスを並べた領域(幅と、中身の高さの変化を見る) */
  listRef: RefObject<HTMLDivElement | null>
  /** スレのヘッダー。スクロール領域の中にあるときは、その高さを差し引いて位置を合わせる */
  headerRef: RefObject<HTMLDivElement | null>
  /** スレを見分ける値(覚えておいた高さの持ち主) */
  threadKey: string
  log: ThreadLog
  byNo: Map<number, Post>
  /** NG で畳んで出すレスか(畳んだ高さで見積もる。本文の長さで見積もると大きく外れる) */
  isCollapsed?: (p: Post) => boolean
  unreadFrom: number
  active: boolean
  initialPosition?: ScrollPosition
  onSavePosition: (pos: ScrollPosition) => void
  onRead: (no: number) => void
  openPosition: OpenPosition
  autoScrollOnNew: boolean
  /** 一番下を見ているときに届いた新着は、多くても一番下まで送る */
  followToEnd?: boolean
  showThumbnails: boolean
  /** 通知などから指定されたレスへ飛ぶ。seq が変わったときだけ飛ぶ */
  jumpTo?: { no: number; seq: number }
}

export function useThreadScroll(o: Options) {
  const { rootRef, listRef, headerRef, log, byNo, unreadFrom } = o
  // 作り置きの関数から、いまの値を見るための控え
  const latest = useRef(o)
  latest.current = o

  /** スクロール位置の計算で差し引くヘッダーの高さ(ヘッダーがスクロール領域の外にあれば 0) */
  const headerOffset = useCallback(
    () => (rootRef.current?.contains(headerRef.current) ? (headerRef.current?.offsetHeight ?? 0) : 0),
    [rootRef, headerRef],
  )

  const positioned = useRef(false)
  /** 開いてから、まだ本人がスクロールの操作(ホイール・クリック・キー)をしていないか */
  const untouched = useRef(true)
  /** 開いてから、まだ新着を受け取っていない(次に届くのは開いたときの取得の分) */
  const firstGrowth = useRef(true)
  /** 知らせた既読の番号 */
  const sent = useRef(log.readNo)
  const atBottom = useRef(false)
  /** 開いたときに未読の頭がまだ手元になかった。新着が届いたらそこへ移る */
  const pendingUnread = useRef(false)
  const position = useRef<ScrollPosition | undefined>(o.initialPosition)
  /** 前の描画のときの最後のレス番号とレス数(新着を見分ける) */
  const lastMax = useRef(0)
  const prevCount = useRef(log.posts.length)

  // ── 高さ ──

  /** レス一覧の幅。高さの見積もりと、覚えた高さの持ち分けに使う */
  const [width, setWidth] = useState(0)
  const widthRef = useRef(0)
  widthRef.current = width
  const metrics = useRef({ fontSize: 16 })

  /** 本文から見積もった高さ(測った高さでの補正の前) */
  const rawEstimate = (p: Post): number => {
    const w = widthRef.current
    const f = metrics.current.fontSize
    return estimatePostHeight(p, {
      // 本文の左右の余白とアイコンの分を除いた幅に、全角が何文字入るか
      charsPerLine: Math.max(10, Math.floor((w - 96) / f)),
      lineHeight: f * 1.625,
      chrome: f * 2.5 + 16,
      thumbRow: 88,
      linkPreview: 88,
      showThumbnails: latest.current.showThumbnails,
    })
  }
  /**
   * 見積もりの補正。測ったレスの「実際の高さ − 見積もり」を覚え、その中央値を見積もりに足す。
   * レスの見た目(カード・Discord 風・専ブラ風・LINE 風)や密度で頭の部分・余白の高さが変わり、決め打ちの見積もりでは
   * 1 レスあたり十数 px ずれていた。ずれが積もると、スクロールするにつれてスレ全体の高さが変わり、スクロールバーがガタついた。
   * 中央値なので、畳まれたあぼーんのような外れた高さには引きずられない
   */
  const calib = useRef({ width: 0, diffs: [] as number[], offset: 0, collapsed: [] as number[], collapsedHeight: 0 })
  /** 補正が使えるようになったら 1 回描き直す(仮の高さを、スクロールする前に補正した値にしておく) */
  const [calibReady, setCalibReady] = useState(false)
  const learn = (no: number, actual: number) => {
    const c = calib.current
    const w = widthRef.current
    if (c.width !== w) Object.assign(c, { width: w, diffs: [], offset: 0, collapsed: [], collapsedHeight: 0 })
    const p = latest.current.byNo.get(no)
    if (!p) return
    // 畳んだレスは、高さそのものを別に覚える(中央値)
    if (latest.current.isCollapsed?.(p)) {
      c.collapsed.push(actual)
      if (c.collapsed.length > 50) c.collapsed.shift()
      c.collapsedHeight = [...c.collapsed].sort((a, b) => a - b)[c.collapsed.length >> 1]
      return
    }
    c.diffs.push(actual - rawEstimate(p))
    if (c.diffs.length > 200) c.diffs.shift()
    // 少し集まってから使う
    if (c.diffs.length >= 8) {
      const sorted = [...c.diffs].sort((a, b) => a - b)
      c.offset = sorted[sorted.length >> 1]
      setCalibReady(true)
    }
  }

  /** まだ描いていないレスの仮の高さ(content-visibility の contain-intrinsic-size に使う) */
  const intrinsicHeight = useCallback(
    (p: Post): number => {
      const w = widthRef.current
      const known = heights.get(latest.current.threadKey, w, p.no)
      if (known !== undefined) return known
      const c = calib.current
      const same = c.width === w
      if (latest.current.isCollapsed?.(p)) return same && c.collapsedHeight > 0 ? c.collapsedHeight : 36
      return Math.max(16, rawEstimate(p) + (same ? c.offset : 0))
    },
    // 幅が変わったら・補正が使えるようになったら見積もり直す
    [width, calibReady],
  )

  /** 画面の近くにある(描かれている)レスの高さを覚える */
  const rememberHeights = (rects: { no: number; top: number; bottom: number; hidden: boolean; placeholder?: boolean }[], from: number, to: number) => {
    const w = widthRef.current
    if (w <= 0) return
    for (const r of rects) {
      // まだ中身を作っていないレス(仮の高さの箱)は覚えない
      if (r.hidden || r.placeholder || r.bottom < from || r.top > to) continue
      const h = Math.round(r.bottom - r.top)
      if (heights.get(latest.current.threadKey, w, r.no) === undefined) learn(r.no, h)
      heights.set(latest.current.threadKey, w, r.no, h)
    }
  }

  /**
   * 中身を作ってあるレスの高さを、いますぐ全部覚える。スマホで画面から遠いレスの中身を外す(仮の高さの箱に戻す)前に呼ぶ。
   * 覚えておけば、箱に戻しても高さが変わらず、スクロールの位置もスクロールバーも動かない
   */
  const rememberRendered = useCallback(() => {
    const root = rootRef.current
    const w = widthRef.current
    if (!root || w <= 0) return
    for (const el of postFrames(root)) {
      if (el.hidden || el.dataset.placeholder !== undefined) continue
      const no = Number(el.dataset.post)
      const h = Math.round(el.getBoundingClientRect().height)
      if (heights.get(latest.current.threadKey, w, no) === undefined) learn(no, h)
      heights.set(latest.current.threadKey, w, no, h)
    }
  }, [rootRef])

  // ── 動かす ──

  /**
   * レスの頭がヘッダーの下に来るようにスクロールする(ミニマップの印から飛ぶとき)。
   * 飛んだあとに上のレスのサムネイルなどが読み込まれて高さが変わっても、そのレスを同じ位置に留める
   */
  const scrollToPost = useCallback(
    (no: number) => {
      const root = rootRef.current
      const el = root?.querySelector<HTMLElement>(`[data-no="${no}"]`)
      if (!root || !el) return
      pinScroll(root, () => root.scrollTop + el.getBoundingClientRect().top - root.getBoundingClientRect().top - headerOffset() - 8)
    },
    [rootRef, headerOffset],
  )

  /**
   * 未読の頭を、見えている範囲の上から UNREAD_AT の位置に置く。
   * 上には既読のレスが少し見え、その下の「ここから未読」の線から下が未読、とひと目で分かるように
   */
  const scrollToUnread = useCallback(
    (no: number, behavior: 'instant' | 'animate' = 'instant') => {
      const root = rootRef.current
      if (!root) return
      // 絞り込みで隠れているレスは位置が取れない(0 になって上へ飛んでしまう)ので、
      // その後ろで見えている最初のレスへ送る。なければ一番下に留まる
      const target = [...postFrames(root)].find((w) => !w.hidden && Number(w.dataset.post) >= no)
      const ms = behavior === 'animate' ? JUMP_MS : 0
      if (!target) return animateScroll(root, () => root.scrollHeight, ms)
      // 「ここから未読」の線はレスの直前(枠の中)にあるので、枠ごとの位置で合わせる。
      // 上のレスが描かれて高さが変わっても合うよう、行き先は毎回測り直す
      const headerH = headerOffset()
      const visible = root.clientHeight - headerH
      animateScroll(
        root,
        () => root.scrollTop + target.getBoundingClientRect().top - root.getBoundingClientRect().top - headerH - visible * UNREAD_AT,
        ms,
      )
    },
    [rootRef, headerOffset],
  )

  /** 一番下・一番上へ。押して飛ぶときはすぐ移る(長いスレを流れていくのを待たせない)。新着を追いかけるときだけ animate */
  const jumpToBottom = useCallback(
    (animate = false) => {
      const root = rootRef.current
      if (root) animateScroll(root, () => root.scrollHeight, animate ? JUMP_MS : 0)
    },
    [rootRef],
  )

  const jumpToTop = useCallback(() => {
    const root = rootRef.current
    if (root) animateScroll(root, () => 0, 0)
  }, [rootRef])

  /** いま読んでいる位置(一番上に見えているレスと、一番下にいるか) */
  const getPosition = useCallback((): ScrollPosition | undefined => position.current && { ...position.current, bottom: atBottom.current }, [])

  /** 覚えておいた位置へすぐ戻す(一番下にいたなら一番下へ)。絞り込みを解いたときなどに使う */
  const restorePosition = useCallback(
    (pos: ScrollPosition) => {
      const root = rootRef.current
      if (!root) return
      if (pos.bottom) return animateScroll(root, () => root.scrollHeight, 0)
      const el = root.querySelector<HTMLElement>(`[data-post="${pos.no}"]`)
      if (!el) return
      animateScroll(root, () => root.scrollTop + el.getBoundingClientRect().top - root.getBoundingClientRect().top - headerOffset() - pos.offset, 0)
    },
    [rootRef, headerOffset],
  )

  /** 次(dir=1)・前(dir=-1)のレスの頭を、ヘッダーのすぐ下に合わせる(キー操作)。合わせたレスの番号を返す */
  const stepPost = useCallback(
    (dir: 1 | -1): number | undefined => {
      const root = rootRef.current
      if (!root) return undefined
      const viewTop = root.getBoundingClientRect().top + headerOffset()
      const frames = [...postFrames(root)].filter((w) => !w.hidden)
      const target =
        dir > 0
          ? frames.find((w) => w.getBoundingClientRect().top > viewTop + 2)
          : frames.findLast((w) => w.getBoundingClientRect().top < viewTop - 2)
      if (!target) {
        // もう先がなければ、端まで送る(選ぶレスは端のレス)
        if (dir > 0) jumpToBottom()
        else jumpToTop()
        const edge = dir > 0 ? frames.at(-1) : frames[0]
        return edge ? Number(edge.dataset.post) : undefined
      }
      animateScroll(root, () => root.scrollTop + target.getBoundingClientRect().top - viewTop, STEP_MS)
      return Number(target.dataset.post)
    },
    [rootRef, headerOffset, jumpToBottom, jumpToTop],
  )

  /**
   * 1 画面ぶん(half なら半画面ぶん)下(dir=1)・上(dir=-1)へ。少し重ねて、続きが分かるようにする(キー操作)。
   * 実際に動く量(端で止まる分を引いたもの)を返す
   */
  const page = useCallback(
    (dir: 1 | -1, half = false): number => {
      const root = rootRef.current
      if (!root) return 0
      const full = root.clientHeight - headerOffset()
      const max = root.scrollHeight - root.clientHeight
      const to = Math.min(max, Math.max(0, root.scrollTop + dir * Math.max(40, half ? full / 2 : full - PAGE_OVERLAP_PX)))
      const moved = to - root.scrollTop
      animateScroll(root, () => to, STEP_MS)
      return moved
    },
    [rootRef, headerOffset],
  )

  // ── 読んだところ ──

  /** どこまで読んだかを測って知らせ、読んでいた位置を覚える */
  const reportRead = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    const box = root.getBoundingClientRect()
    const viewTop = box.top + headerOffset()
    const rects: PostRect[] = []
    // 枠を測る(中身を測ると、画面の外で省いた計算をやり直させてしまう)。
    // 画面より 1 画面ぶん下までで止める(その先は既読にも高さを覚えるのにも要らない)
    for (const el of postFrames(root)) {
      const r = el.getBoundingClientRect()
      rects.push({ no: Number(el.dataset.post), top: r.top, bottom: r.bottom, hidden: el.hidden, placeholder: el.dataset.placeholder !== undefined })
      if (r.top >= box.bottom + box.height) break
    }
    atBottom.current = root.scrollHeight - root.scrollTop - root.clientHeight < BOTTOM_PX
    const { last, position: pos } = readProgress({
      rects,
      viewTop,
      viewBottom: box.bottom,
      atBottom: atBottom.current,
      lastNo: latest.current.log.posts.at(-1)?.no ?? 0,
    })
    // 描かれているのは画面とその上下半画面ほど(content-visibility の範囲)なので、そこだけ覚える
    rememberHeights(rects, box.top - box.height / 2, box.bottom + box.height / 2)
    if (pos) position.current = pos
    if (last > sent.current) {
      sent.current = last
      latest.current.onRead(last)
    }
  }, [rootRef, headerOffset])

  // ── 開いたとき ──

  // 最初にレスが出たときだけ、設定どおりの位置へ移動する
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || positioned.current || log.posts.length === 0) return
    positioned.current = true
    // 開いたときは空のログ(読み込み中)から始まることがあるので、既読の番号は中身が届いたこの時に合わせる
    sent.current = Math.max(sent.current, log.readNo)
    const saved = latest.current.initialPosition
    const savedEl = saved ? root.querySelector<HTMLElement>(`[data-post="${saved.no}"]`) : null
    const t = openTarget({
      saved,
      savedFound: !!savedEl,
      openPosition: latest.current.openPosition,
      unreadFrom,
      hasUnreadPost: byNo.has(unreadFrom),
    })
    // 開いたあとも、上のレスの画像・リンクのカードが読み込まれて高さが変わるので、見ていたレスをしばらく同じ位置に留める(pinScroll)。
    // 本人がスクロールしたらやめる
    if (t.kind === 'bottom') {
      animateScroll(root, () => root.scrollHeight, 0)
      pendingUnread.current = t.pendingUnread
    } else if (t.kind === 'unread') {
      const target = [...postFrames(root)].find((w) => !w.hidden && Number(w.dataset.post) >= t.no)
      if (target) {
        const headerH = headerOffset()
        pinScroll(root, () => root.scrollTop + target.getBoundingClientRect().top - root.getBoundingClientRect().top - headerH - (root.clientHeight - headerH) * UNREAD_AT)
      } else scrollToUnread(t.no)
    } else if (t.kind === 'saved' && savedEl) {
      // 行き先は毎回測り直す(大きさが決まる前や、上のレスが描かれて高さが変わっても合うように)
      pinScroll(root, () => root.scrollTop + savedEl.getBoundingClientRect().top - root.getBoundingClientRect().top - headerOffset() - t.position.offset)
    }
    // この描画で届いたレスは「新着」として扱わない(下の effect が追いかけないように)
    prevCount.current = log.posts.length
    lastMax.current = log.posts.at(-1)?.no ?? 0
    reportRead()
  }, [log, unreadFrom, byNo, rootRef, headerOffset, reportRead, scrollToUnread])

  // 画面から外れるときに、読んでいた位置を渡す
  useEffect(
    () => () => {
      if (position.current) latest.current.onSavePosition(position.current)
    },
    [],
  )

  // 通知などから指定されたレスへ飛ぶ(開いたときの位置合わせのあとに)
  useEffect(() => {
    if (o.jumpTo && byNo.has(o.jumpTo.no)) scrollToUnread(o.jumpTo.no, 'animate')
    // seq が変わったときだけ飛ぶ
  }, [o.jumpTo?.seq, byNo.size > 0])

  // ── 新着 ──

  // 新着として光らせ、順に出すレス。届いたときに番号と遅れ(ms)を控え、出し終わったら消す
  // (描画のたびに「前回より後ろ」を計算し直すと、既読の保存などで描き直された時点で光が途中で切れていた)
  const [flashNos, setFlashNos] = useState<Map<number, number>>(new Map())
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(flashTimer.current), [])

  useLayoutEffect(() => {
    const root = rootRef.current
    const grew = log.posts.length > prevCount.current
    prevCount.current = log.posts.length
    const prevLastNo = lastMax.current
    lastMax.current = log.posts.at(-1)?.no ?? 0
    if (!root || !grew || !positioned.current) return
    const fresh = log.posts.filter((p) => p.no > prevLastNo).map((p) => p.no)
    setFlashNos(staggerDelays(fresh, STAGGER_MS, STAGGER_TOTAL_MS))
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlashNos(new Map()), FLASH_MS + STAGGER_TOTAL_MS)
    const opening = untouched.current && firstGrowth.current
    firstGrowth.current = false
    const target = newPostsTarget({
      pendingUnread: pendingUnread.current,
      unreadFrom,
      hasUnreadPost: byNo.has(unreadFrom),
      prevLastNo,
      readNo: sent.current,
      opening,
      autoScrollOnNew: latest.current.autoScrollOnNew,
      followToEnd: latest.current.followToEnd,
      atBottom: atBottom.current,
    })
    pendingUnread.current = false
    if (target && 'bottom' in target) jumpToBottom(true)
    else if (target) scrollToUnread(target.no, target.animate ? 'animate' : 'instant')
  }, [log.posts.length, byNo, unreadFrom, rootRef, scrollToUnread, jumpToBottom])

  // ── 見張り ──

  // 一番下へ飛ぶ丸いボタン。一番下から 1 画面ぶん以上離れているときだけ出す
  const [showJump, setShowJump] = useState(false)
  const updateJump = useCallback(() => {
    const root = rootRef.current
    if (root) setShowJump(root.scrollHeight - root.scrollTop - root.clientHeight > root.clientHeight)
  }, [rootRef])
  useLayoutEffect(updateJump, [log.posts.length, updateJump])

  // スクロールしたとき・中身の高さが変わったとき(新着が届いた・レスが描かれた)に、既読を進める。
  // 1 画面に収まるスレや、届いた新着がそのまま見えているときは、スクロールが起きないため高さの変化も見る。
  // 裏に残しているタブでは進めない(見ていないので)
  useEffect(() => {
    const root = rootRef.current
    const list = listRef.current
    if (!root) return
    let timer: ReturnType<typeof setTimeout>
    const later = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (latest.current.active) reportRead()
      }, READ_DELAY_MS)
    }
    const onScroll = () => {
      const rest = root.scrollHeight - root.scrollTop - root.clientHeight
      atBottom.current = rest < BOTTOM_PX
      setShowJump(rest > root.clientHeight)
      later()
    }
    // 幅を覚え直すと全部のレスの仮の高さを描き直すので、大きさが変わり続けているあいだは待ち、落ち着いてから 1 回だけ
    let widthTimer: ReturnType<typeof setTimeout>
    const observer = new ResizeObserver(() => {
      updateJump()
      if (list) {
        const apply = () => {
          setWidth(list.clientWidth)
          metrics.current.fontSize = parseFloat(getComputedStyle(list).fontSize) || 16
        }
        clearTimeout(widthTimer)
        // まだ幅を知らない(開いたばかり)ときはすぐ覚える
        if (widthRef.current === 0) apply()
        else widthTimer = setTimeout(apply, 150)
      }
      later()
    })
    observer.observe(root)
    if (list) observer.observe(list)
    // 本人がスレ表示を触ったら、それ以降の新着へは動かして見せる
    const touch = () => {
      untouched.current = false
    }
    root.addEventListener('scroll', onScroll)
    root.addEventListener('wheel', touch, { passive: true })
    root.addEventListener('pointerdown', touch)
    root.addEventListener('keydown', touch)
    return () => {
      observer.disconnect()
      clearTimeout(timer)
      clearTimeout(widthTimer)
      root.removeEventListener('scroll', onScroll)
      root.removeEventListener('wheel', touch)
      root.removeEventListener('pointerdown', touch)
      root.removeEventListener('keydown', touch)
    }
  }, [rootRef, listRef, updateJump, reportRead])

  // 裏のタブから表に戻したときも、見えている分を既読にする
  useEffect(() => {
    if (o.active && positioned.current) reportRead()
  }, [o.active, reportRead])

  return {
    scrollToPost,
    scrollToUnread,
    jumpToBottom,
    jumpToTop,
    stepPost,
    page,
    showJump,
    flashNos,
    intrinsicHeight,
    getPosition,
    restorePosition,
    /** いま見えているところまでの既読を、待たずにすぐ知らせる(更新の直前など) */
    flushRead: reportRead,
    rememberRendered,
  }
}

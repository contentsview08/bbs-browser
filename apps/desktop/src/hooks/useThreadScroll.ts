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

/**
 * 決めた時間で、素早く(終わりだけゆっくり)スクロールする。ms が 0 ならその場で移る。
 * ブラウザのなめらかなスクロールは、距離が長いと遅く、途中で別のスクロールに割り込まれると止まるので使わない。
 * 行き先は関数で受け取り、動いている間に中身が増えても、毎回その時点の行き先へ向かう。
 * 着いたあとも、画面の外で省いていたレス(.post-cv)が本当の高さで描かれて行き先がずれるので、
 * 行き先が SETTLE_MS 動かなくなるまで追いかける。そのあいだにホイールやクリック、キーを押したらやめる
 */
export function animateScroll(root: HTMLElement, target: () => number, ms = JUMP_MS) {
  const clamped = () => Math.max(0, Math.min(target(), root.scrollHeight - root.clientHeight))
  const from = root.scrollTop
  const start = performance.now()
  let stopped = false
  const stop = () => {
    stopped = true
    root.removeEventListener('wheel', stop)
    root.removeEventListener('pointerdown', stop)
    window.removeEventListener('keydown', stop)
  }
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
  unreadFrom: number
  active: boolean
  initialPosition?: ScrollPosition
  onSavePosition: (pos: ScrollPosition) => void
  onRead: (no: number) => void
  openPosition: OpenPosition
  autoScrollOnNew: boolean
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

  /** まだ描いていないレスの仮の高さ(content-visibility の contain-intrinsic-size に使う) */
  const intrinsicHeight = useCallback(
    (p: Post): number => {
      const w = widthRef.current
      const known = heights.get(latest.current.threadKey, w, p.no)
      if (known !== undefined) return known
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
    },
    // 幅が変わったら見積もり直す
    [width],
  )

  /** 画面の近くにある(描かれている)レスの高さを覚える */
  const rememberHeights = (rects: { no: number; top: number; bottom: number; hidden: boolean }[], from: number, to: number) => {
    const w = widthRef.current
    if (w <= 0) return
    for (const r of rects) {
      if (r.hidden || r.bottom < from || r.top > to) continue
      heights.set(latest.current.threadKey, w, r.no, Math.round(r.bottom - r.top))
    }
  }

  // ── 動かす ──

  /** レスの頭がヘッダーの下に来るようにスクロールする */
  const scrollToPost = useCallback(
    (no: number, behavior: ScrollBehavior = 'instant') => {
      const root = rootRef.current
      const el = root?.querySelector<HTMLElement>(`[data-no="${no}"]`)
      if (!root || !el) return
      const top = root.scrollTop + el.getBoundingClientRect().top - root.getBoundingClientRect().top - headerOffset() - 8
      root.scrollTo({ top, behavior })
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

  const jumpToBottom = useCallback(() => {
    const root = rootRef.current
    if (root) animateScroll(root, () => root.scrollHeight)
  }, [rootRef])

  const jumpToTop = useCallback(() => {
    const root = rootRef.current
    if (root) animateScroll(root, () => 0)
  }, [rootRef])

  /** 次(dir=1)・前(dir=-1)のレスの頭を、ヘッダーのすぐ下に合わせる(キー操作) */
  const stepPost = useCallback(
    (dir: 1 | -1) => {
      const root = rootRef.current
      if (!root) return
      const viewTop = root.getBoundingClientRect().top + headerOffset()
      const frames = [...postFrames(root)].filter((w) => !w.hidden)
      const target =
        dir > 0
          ? frames.find((w) => w.getBoundingClientRect().top > viewTop + 2)
          : frames.findLast((w) => w.getBoundingClientRect().top < viewTop - 2)
      if (!target) return dir > 0 ? jumpToBottom() : jumpToTop()
      animateScroll(root, () => root.scrollTop + target.getBoundingClientRect().top - viewTop, STEP_MS)
    },
    [rootRef, headerOffset, jumpToBottom, jumpToTop],
  )

  /** 1 画面ぶん下(dir=1)・上(dir=-1)へ。少し重ねて、続きが分かるようにする(キー操作) */
  const page = useCallback(
    (dir: 1 | -1) => {
      const root = rootRef.current
      if (!root) return
      const to = root.scrollTop + dir * Math.max(40, root.clientHeight - headerOffset() - PAGE_OVERLAP_PX)
      animateScroll(root, () => to, STEP_MS)
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
      rects.push({ no: Number(el.dataset.post), top: r.top, bottom: r.bottom, hidden: el.hidden })
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
    const saved = latest.current.initialPosition
    const savedEl = saved ? root.querySelector<HTMLElement>(`[data-post="${saved.no}"]`) : null
    const t = openTarget({
      saved,
      savedFound: !!savedEl,
      openPosition: latest.current.openPosition,
      unreadFrom,
      hasUnreadPost: byNo.has(unreadFrom),
    })
    if (t.kind === 'bottom') {
      animateScroll(root, () => root.scrollHeight, 0)
      pendingUnread.current = t.pendingUnread
    } else if (t.kind === 'unread') scrollToUnread(t.no)
    else if (t.kind === 'saved' && savedEl) {
      // 行き先は毎回測り直す(大きさが決まる前や、上のレスが描かれて高さが変わっても合うように)
      animateScroll(
        root,
        () => root.scrollTop + savedEl.getBoundingClientRect().top - root.getBoundingClientRect().top - headerOffset() - t.position.offset,
        0,
      )
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
      atBottom: atBottom.current,
    })
    pendingUnread.current = false
    if (target) scrollToUnread(target.no, target.animate ? 'animate' : 'instant')
  }, [log.posts.length, byNo, unreadFrom, rootRef, scrollToUnread])

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
    const observer = new ResizeObserver(() => {
      updateJump()
      if (list) {
        setWidth(list.clientWidth)
        metrics.current.fontSize = parseFloat(getComputedStyle(list).fontSize) || 16
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

  return { scrollToPost, scrollToUnread, jumpToBottom, jumpToTop, stepPost, page, showJump, flashNos, intrinsicHeight }
}

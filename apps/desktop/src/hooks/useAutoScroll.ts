// 自動で流す(オートスクロール)。速さの決まりは utils/autoScroll.ts(テストあり)、ここでは測って動かすだけにする。
// - 毎コマ、スクロールの残り(scrollHeight − scrollTop − clientHeight)を測り直して速さを決める
//   (画像の読み込み・NG で高さが変わっても、勝手に合う)
// - 利用者が動かしたら(ホイール・指・スクロールバー・キーや飛ぶ操作)一時停止し、自分で一番下まで戻ったら追いついた後の段として再開する
// - 開いた直後の位置決めや、ほかの所の動き(useThreadScroll の runMove)の最中は動かさない

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { autoScrollBacklogged, autoScrollSpeed, msToNextRefresh, type AutoScrollSpeed } from '../utils/autoScroll'
import { firstAfter } from '../utils/cursor'
import { framesIn, isMoving } from './useThreadScroll'

/** 自動更新の前回の時刻(App の自動更新のタイマーが知らせる)。次の更新までの時間を出すのに使う */
let lastAutoRefreshAt: number | undefined
/** 自動更新のタイマーを始めた・回ったときに呼ぶ。止めたら undefined */
export function noteAutoRefreshTick(at: number | undefined) {
  lastAutoRefreshAt = at
}

/** 一番下に着いたとみなす残り(px)。小数の端数で着かないことがないように */
const AT_END_PX = 1
/** 1 コマで進める時間の上限(裏から戻ったときなどに、大きく飛ばないように) */
const MAX_STEP_S = 0.1
/** 行の高さ・溜まった分を測り直す間隔 */
const MEASURE_MS = 500
/** 流している間に既読を知らせる間隔(スクロールが止まるのを待つ既読の知らせは、流している間は来ないため) */
const READ_MS = 500

interface Options {
  rootRef: RefObject<HTMLDivElement | null>
  listRef: RefObject<HTMLDivElement | null>
  /** 自動で流すを入れているか */
  on: boolean
  /** 開いているタブか */
  active: boolean
  speed: AutoScrollSpeed
  autoRefreshSec: number
  /** 開いたときの位置決めが済んだか */
  ready: () => boolean
  /** いま見えているところまでの既読を知らせる */
  flushRead: () => void
  /** 一番下へすぐ移る */
  jumpToBottom: () => void
}

export function useAutoScroll(o: Options) {
  const latest = useRef(o)
  latest.current = o
  /** 溜まった分が多すぎるときの、画面より下にあるレスの数(札に出す)。多くなければ undefined */
  const [backlog, setBacklog] = useState<number>()
  /** 利用者が動かして一時停止しているか */
  const paused = useRef(false)
  /** 一度一番下に着いたか(着いた後は、次の更新に合わせて流す) */
  const caughtUp = useRef(false)
  /** 札を押して一番下へ移っている間(自分の動きなので、一時停止にしない) */
  const jumping = useRef(false)

  const { on, active, rootRef } = o
  useEffect(() => {
    const root = rootRef.current
    if (!on || !active || !root) {
      setBacklog(undefined)
      return
    }
    paused.current = false
    caughtUp.current = false
    jumping.current = false
    /** 小数まで持つ位置(scrollTop は端数を丸めることがあり、ゆっくり流すと 1 コマの量が 1px に届かない) */
    let pos = NaN
    let written = NaN
    let last = performance.now()
    let lineHeight = 0
    let measuredAt = -Infinity
    let readAt = last
    let raf = 0

    const pause = () => {
      if (jumping.current) return
      paused.current = true
      pos = NaN
    }
    /** 行の高さ(本文の文字 × 行間)。本文がまだなければ、レス一覧の字の大きさから見積もる */
    const measureLine = () => {
      const list = latest.current.listRef.current
      const body = list?.querySelector<HTMLElement>('[data-post-body]')
      const cs = body ? getComputedStyle(body) : list ? getComputedStyle(list) : undefined
      const font = parseFloat(cs?.fontSize ?? '') || 16
      lineHeight = (body && parseFloat(cs!.lineHeight)) || font * 1.625
    }
    /** 画面より下にあるレスの数 */
    const countBelow = () => {
      const frames = framesIn(latest.current.listRef.current)
      const bottom = root.getBoundingClientRect().bottom
      const i = firstAfter(frames.length, (k) => (frames[k].hidden ? undefined : frames[k].getBoundingClientRect().top), bottom)
      let n = 0
      for (let k = i; k < frames.length; k++) if (!frames[k].hidden) n++
      return n
    }

    const step = (now: number) => {
      raf = requestAnimationFrame(step)
      const dt = Math.min(MAX_STEP_S, Math.max(0, (now - last) / 1000))
      last = now
      const max = root.scrollHeight - root.clientHeight
      // 位置決め・ほかの動きの最中は動かさない。利用者の操作(キー・飛ぶ)で始まった動きなら一時停止にする
      if (!latest.current.ready()) return
      if (isMoving(root)) {
        if (!jumping.current) pause()
        pos = NaN
        return
      }
      if (jumping.current) {
        jumping.current = false
        caughtUp.current = true
      }
      if (paused.current) {
        // 自分で一番下まで戻ったら、追いついた後の段として再開する
        if (max - root.scrollTop > AT_END_PX) return
        paused.current = false
        caughtUp.current = true
      }
      // 自分の書いた位置から動いていたら(上のレスの高さが変わって位置を直した など)、今の位置から続ける
      if (!Number.isFinite(pos) || Math.abs(root.scrollTop - written) >= 1) pos = root.scrollTop
      if (now - measuredAt >= MEASURE_MS) {
        measuredAt = now
        measureLine()
        const rest = max - pos
        const many = autoScrollBacklogged(rest, root.clientHeight)
        const n = many ? countBelow() : undefined
        setBacklog((b) => (b === n ? b : n))
      }
      let rest = max - pos
      if (!caughtUp.current && rest <= AT_END_PX) caughtUp.current = true
      const o = latest.current
      const v = autoScrollSpeed(rest, msToNextRefresh(o.autoRefreshSec, lastAutoRefreshAt, Date.now()), lineHeight, o.speed, caughtUp.current)
      if (v <= 0) return
      pos = Math.min(max, pos + v * dt)
      rest = max - pos
      root.scrollTop = rest <= AT_END_PX / 2 ? max : pos
      written = root.scrollTop
      if (now - readAt >= READ_MS) {
        readAt = now
        o.flushRead()
      }
    }
    raf = requestAnimationFrame(step)

    // ホイール・指・スクロールバーで動かしたら一時停止
    const onPressRoot = (e: PointerEvent) => {
      if (e.target === root) pause()
    }
    root.addEventListener('wheel', pause, { passive: true })
    root.addEventListener('touchmove', pause, { passive: true })
    root.addEventListener('pointerdown', onPressRoot)
    return () => {
      cancelAnimationFrame(raf)
      root.removeEventListener('wheel', pause)
      root.removeEventListener('touchmove', pause)
      root.removeEventListener('pointerdown', onPressRoot)
      setBacklog(undefined)
    }
  }, [on, active, rootRef])

  /** 札を押したとき: 一番下へ飛び、追いついた後の段で続ける */
  const jumpToEnd = useCallback(() => {
    jumping.current = true
    paused.current = false
    setBacklog(undefined)
    latest.current.jumpToBottom()
  }, [])

  /** いま流しているか(一時停止していない) */
  const flowing = useCallback(() => latest.current.on && latest.current.active && !paused.current, [])

  return { backlog, jumpToEnd, flowing }
}

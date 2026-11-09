// 実況モード(bbs-suite の docs/autoscroll.md)。速さの決まりは utils/autoScroll.ts、ライブの段で出す時刻は utils/liveReveal.ts(どちらもテストあり)。
// ここでは測って動かすだけにする。
// - 追いつくまで: 流す速さで一定に流す。毎コマ残りを測り直す(画像の読み込み・NG で高さが変わっても合う)
// - 一番下に着いたら、ライブの段: 流すのをやめ、届いたレスを useLiveReveal が 1 件ずつ出し、一覧を一番下にくっつけておく
// - 利用者が動かしたら(ホイール・指・スクロールバー・キーや飛ぶ操作)止め、ライブの段なら隠していたレスを全部出す。
//   自分で一番下まで戻ったら、ライブの段に戻る
// - 開いた直後の位置決めや、ほかの所の動き(useThreadScroll の runMove)の最中は動かさない

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { Post } from '@bbs-browser/connectors'
import { liveScrollPxPerSec, liveStickAction } from '../utils/autoScroll'
import { liveQueueTimes, liveRevealSchedule, postTimeMs } from '../utils/liveReveal'
import { isMoving } from './useThreadScroll'

/** 一番下に着いたとみなす残り(px)。小数の端数で着かないことがないように */
const AT_END_PX = 1
/** 利用者が触ってから、くっつけるのを待つ時間(スクロールはイベントの少し後に動くので、その間に引き戻さない) */
const TOUCH_GRACE_MS = 300
/** 1 コマで進める時間の上限(裏から戻ったときなどに、大きく飛ばないように) */
const MAX_STEP_S = 0.1
/** 行の高さを測り直す間隔 */
const MEASURE_MS = 500
/** 流している間に既読を知らせる間隔(スクロールが止まるのを待つ既読の知らせは、流している間は来ないため) */
const READ_MS = 500

/**
 * ライブの段で、届いたレスを 1 件ずつ出す。count は出してよいレスの数(posts の先頭から)。ライブの段でなければ undefined(全部出す)。
 * まだ出していないレスは画面に作らない(既読も付かない)
 */
export function useLiveReveal(posts: Post[], intervalSec: number) {
  const [count, setCount] = useState<number>()
  const postsRef = useRef(posts)
  postsRef.current = posts
  const intervalMs = intervalSec * 1000
  /** 渡し終えたレスの数・まだ出していないレスを出す時刻・次の基準の時刻 */
  const st = useRef<{ known: number; queue: number[]; base: number | null }>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const tick = useCallback(() => {
    clearTimeout(timer.current)
    const s = st.current
    if (!s) return
    const now = Date.now()
    while (s.queue.length > 0 && s.queue[0] <= now) s.queue.shift()
    setCount(s.known - s.queue.length)
    if (s.queue.length > 0) timer.current = setTimeout(tick, s.queue[0] - now)
  }, [])

  const start = useCallback(() => {
    if (st.current) return
    const ps = postsRef.current
    const last = ps.at(-1)
    st.current = { known: ps.length, queue: [], base: last ? postTimeMs(last.date) : null }
    setCount(ps.length)
  }, [])

  const stop = useCallback(() => {
    clearTimeout(timer.current)
    st.current = undefined
    setCount(undefined)
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  useEffect(() => {
    const s = st.current
    if (!s || posts.length === s.known) return
    // 取り直しでログが入れ替わった(減った)ら、いまある分を出したことにして続ける
    if (posts.length < s.known) {
      s.known = posts.length
      s.queue = []
      setCount(posts.length)
      return
    }
    const batch = posts.slice(s.known)
    const now = Date.now()
    const delays = liveRevealSchedule(
      batch.map((p) => postTimeMs(p.date)),
      s.base,
      intervalMs,
    )
    const { at, flush } = liveQueueTimes(now, delays, s.queue.at(-1), intervalMs)
    s.known = posts.length
    s.base = postTimeMs(batch.at(-1)!.date)
    s.queue = flush ? [] : [...s.queue, ...at]
    tick()
  }, [posts, intervalMs, tick])

  return { count, start, stop }
}

interface Options {
  rootRef: RefObject<HTMLDivElement | null>
  listRef: RefObject<HTMLDivElement | null>
  /** 実況モードを入れているか */
  on: boolean
  /** 開いているタブか */
  active: boolean
  /** 流す速さ(1 秒に何行) */
  speed: number
  /** 開いたときの位置決めが済んだか */
  ready: () => boolean
  /** ライブの段に入ってよいか(入ってすぐの更新が済むまでは、一番下にいても追いつくまでの段で待つ) */
  canGoLive: () => boolean
  /** いま見えているところまでの既読を知らせる */
  flushRead: () => void
  /** ライブの段で出すレス(useLiveReveal) */
  reveal: ReturnType<typeof useLiveReveal>
}

export function useAutoScroll(o: Options) {
  const latest = useRef(o)
  latest.current = o
  /** 利用者が動かして止めているか */
  const paused = useRef(false)
  /** ライブの段か */
  const [live, setLive] = useState(false)
  const liveRef = useRef(false)
  liveRef.current = live
  /** 自分で書いた scrollTop。これと違えば、ほかの誰か(多くは利用者)が動かした */
  const writtenRef = useRef(NaN)
  /** 利用者が最後に触った時刻(ホイール・指・スクロールバー・キーで動かし中) */
  const touchedAtRef = useRef(-Infinity)
  /** 利用者が動かしたので、ライブの段から外れて止める(レスを出した直後の寄せからも呼ぶ) */
  const leaveByUserRef = useRef<() => void>(() => {})

  const { on, active, rootRef } = o
  useEffect(() => {
    const root = rootRef.current
    if (!on || !active || !root) return
    paused.current = false
    /** 小数まで持つ位置(scrollTop は端数を丸めることがあり、ゆっくり流すと 1 コマの量が 1px に届かない) */
    let pos = NaN
    const written = writtenRef
    written.current = NaN
    let last = performance.now()
    let lineHeight = 0
    let measuredAt = -Infinity
    let readAt = last
    touchedAtRef.current = -Infinity
    let raf = 0

    const touch = () => {
      touchedAtRef.current = performance.now()
    }
    const enterLive = () => {
      if (liveRef.current) return
      liveRef.current = true
      // ここからの動きを、利用者が動かしたかの見分けの元にする
      written.current = root.scrollTop
      setLive(true)
      latest.current.reveal.start()
    }
    const leaveLive = () => {
      if (!liveRef.current) return
      liveRef.current = false
      setLive(false)
      latest.current.reveal.stop()
    }
    leaveByUserRef.current = () => {
      leaveLive()
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

    const step = (now: number) => {
      raf = requestAnimationFrame(step)
      const dt = Math.min(MAX_STEP_S, Math.max(0, (now - last) / 1000))
      last = now
      if (!latest.current.ready()) return
      const max = root.scrollHeight - root.clientHeight
      // キーや飛ぶ操作で動いている間は、利用者が動かしたものとして扱う
      if (isMoving(root)) {
        touch()
        pos = NaN
        return
      }
      const rest = max - root.scrollTop
      const touching = now - touchedAtRef.current < TOUCH_GRACE_MS
      if (paused.current) {
        // 自分で一番下まで戻ったら、ライブの段に戻る
        if (touching || rest > AT_END_PX || !latest.current.canGoLive()) return
        paused.current = false
        enterLive()
      }
      if (liveRef.current) {
        const action = liveStickAction({ rest, moved: Math.abs(root.scrollTop - written.current) >= 1, touching })
        // 上へ動かした: ライブの段から外れ、隠していたレスを全部出して止める
        if (action === 'leave') return leaveByUserRef.current()
        // 一番下にくっつけておく(出したレス・読み込んだ画像で伸びた分を追う)
        if (action === 'stick' && rest > 0) {
          root.scrollTop = max
          written.current = root.scrollTop
        }
        return
      }
      // 追いつくまで: 利用者が触ったら止める
      if (touching) {
        paused.current = true
        pos = NaN
        return
      }
      // 自分の書いた位置から動いていたら(上のレスの高さが変わって位置を直した など)、今の位置から続ける
      if (!Number.isFinite(pos) || Math.abs(root.scrollTop - written.current) >= 1) pos = root.scrollTop
      if (max - pos <= AT_END_PX) {
        if (latest.current.canGoLive()) enterLive()
        return
      }
      if (now - measuredAt >= MEASURE_MS) {
        measuredAt = now
        measureLine()
      }
      const v = liveScrollPxPerSec(latest.current.speed, lineHeight)
      if (v <= 0) return
      pos = Math.min(max, pos + v * dt)
      root.scrollTop = max - pos <= AT_END_PX / 2 ? max : pos
      written.current = root.scrollTop
      if (now - readAt >= READ_MS) {
        readAt = now
        latest.current.flushRead()
      }
    }
    raf = requestAnimationFrame(step)

    // ホイール・指・スクロールバーで動かしたら止める
    const onPressRoot = (e: PointerEvent) => {
      if (e.target === root) touch()
    }
    root.addEventListener('wheel', touch, { passive: true })
    root.addEventListener('touchmove', touch, { passive: true })
    root.addEventListener('pointerdown', onPressRoot)
    return () => {
      cancelAnimationFrame(raf)
      root.removeEventListener('wheel', touch)
      root.removeEventListener('touchmove', touch)
      root.removeEventListener('pointerdown', onPressRoot)
      leaveLive()
      leaveByUserRef.current = () => {}
    }
  }, [on, active, rootRef])

  // ライブの段でレスを出したら、描いた直後に一番下へ寄せ、出した分を既読にする。
  // 寄せてよいかは毎コマと同じ決まり(触った直後・キーで動かし中は寄せず、上へ動かしていたら外れる)
  const { count } = o.reveal
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!live || count === undefined || !root || paused.current) return
    const max = root.scrollHeight - root.clientHeight
    const action = liveStickAction({
      rest: max - root.scrollTop,
      moved: Math.abs(root.scrollTop - writtenRef.current) >= 1,
      touching: isMoving(root) || performance.now() - touchedAtRef.current < TOUCH_GRACE_MS,
    })
    if (action === 'leave') return leaveByUserRef.current()
    if (action === 'stick') {
      root.scrollTop = max
      writtenRef.current = root.scrollTop
    }
    const id = requestAnimationFrame(() => latest.current.flushRead())
    return () => cancelAnimationFrame(id)
  }, [live, count, rootRef])

  /** いま流している・くっつけているか(止めていない) */
  const flowing = useCallback(() => latest.current.on && latest.current.active && !paused.current, [])

  return { live, flowing }
}

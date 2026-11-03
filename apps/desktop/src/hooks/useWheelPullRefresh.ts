// hono-bbs-merge packages/web/src/hooks/useWheelPullRefresh.ts から複製。
// 専ブラでは、端に着いた勢いで更新してしまい、取得が増えすぎたので、armDelayMs と cooldownMs を足した
import { buzz } from '../utils/haptics'
import { useRef } from 'react'
import {
  PULL_HIDDEN_Y,
  PULL_REVEAL_Y,
  PULL_SETTLE_TRANSITION,
  PULL_SNAP_TRANSITION,
  MIN_SPIN_MS,
  dampedPullY,
} from '../utils/pullRefresh'

/** 指でこれだけ引いて離したら更新する(px。元の Web アプリは 70。もう少し軽くした) */
export const TOUCH_COMMIT_PX = 56

interface UseWheelPullRefreshOptions {
  /** 実際の更新処理。Promiseを返せば、その完了とMIN_SPIN_MSの長い方を待ってから収納する */
  onRefresh: () => Promise<unknown> | void
  /** これ未満の累積量ではインジケーターすら出さない(誤反応防止・px相当) */
  revealThreshold?: number
  /** この量だけホイールで引っ張ると確定する(px相当の累積値) */
  commitThreshold?: number
  /** 上端用(下向きに現れる)なら1、下端用(上向きに現れる)なら-1 */
  sign?: 1 | -1
  /**
   * 端に着いてから(最後に noteScroll を呼んでから)これだけたつまでのホイールは数えない。
   * スクロールして端に着いた、その同じ操作の勢いで更新しないように
   */
  armDelayMs?: number
  /** 一度更新したら、これだけたつまでは引っぱっても更新しない(取得のしすぎを防ぐ) */
  cooldownMs?: number
  /** いま更新できるか(クールダウン中なら false)。false のあいだは引っぱっても数えない */
  canRefresh?: () => boolean
}

/**
 * PC版のホイールオーバースクロールによるプルリフレッシュ。
 * スマホのタッチ版(useSwipeGesture内のプル処理)と同じ見た目・タイミングになるよう
 * PULL_* 定数を共有する。1回のホイールイベントで即座に発火せず、revealThresholdに
 * 達するまではインジケーターも出さず、commitThresholdに達するまで累積させる。
 */
export function useWheelPullRefresh({
  onRefresh,
  revealThreshold = 120,
  commitThreshold = 240,
  sign = 1,
  armDelayMs = 500,
  cooldownMs = 0,
  canRefresh,
}: UseWheelPullRefreshOptions) {
  const lastScrollRef = useRef(0)
  const lastCommitRef = useRef(0)
  const indicatorRef = useRef<HTMLDivElement>(null)
  const iconRef = useRef<HTMLSpanElement>(null)
  const accumRef = useRef(0)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const committingRef = useRef(false)

  function clearResetTimer() {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current)
      resetTimerRef.current = null
    }
  }

  function collapse() {
    clearResetTimer()
    accumRef.current = 0
    const ind = indicatorRef.current
    const icon = iconRef.current
    if (ind) {
      ind.style.transition = PULL_SETTLE_TRANSITION
      ind.style.transform = `translateY(${sign * PULL_HIDDEN_Y}px)`
      ind.style.opacity = '0'
    }
    if (icon) icon.style.transform = ''
  }

  function scheduleAutoReset() {
    clearResetTimer()
    // ホイール入力が一定時間止まったら、引っ張りかけの状態を戻す
    resetTimerRef.current = setTimeout(() => {
      if (!committingRef.current) collapse()
    }, 400)
  }

  function commit() {
    if (committingRef.current) return
    committingRef.current = true
    lastCommitRef.current = Date.now()
    clearResetTimer()
    const ind = indicatorRef.current
    const icon = iconRef.current
    if (ind) {
      ind.style.transition = PULL_SNAP_TRANSITION
      ind.style.transform = `translateY(${sign * PULL_REVEAL_Y}px)`
      ind.style.opacity = '1'
    }
    if (icon) {
      icon.style.transform = ''
      icon.classList.add('animate-spin')
    }
    const start = Date.now()
    void (async () => {
      await onRefresh()
      const elapsed = Date.now() - start
      if (elapsed < MIN_SPIN_MS) await new Promise((r) => setTimeout(r, MIN_SPIN_MS - elapsed))
      if (ind) {
        ind.style.transition = PULL_SETTLE_TRANSITION
        ind.style.transform = `translateY(${sign * PULL_HIDDEN_Y}px)`
        ind.style.opacity = '0'
      }
      if (icon) icon.classList.remove('animate-spin')
      accumRef.current = 0
      committingRef.current = false
    })()
  }

  /** このホイールイベント分の「引っ張り量」(常に正の値)を積み増す */
  function pull(deltaAbs: number) {
    if (committingRef.current || deltaAbs <= 0) return
    const now = Date.now()
    // 端に着いたばかり(スクロールの勢いが残っている)か、更新したばかりなら数えない
    if (now - lastScrollRef.current < armDelayMs || now - lastCommitRef.current < cooldownMs || (canRefresh && !canRefresh())) {
      accumRef.current = 0
      return
    }
    accumRef.current = Math.max(0, accumRef.current + deltaAbs)

    // revealThreshold未満は「たまたま少し多くスクロールしただけ」の可能性が高いので
    // インジケーターを一切出さない(誤反応防止)
    if (accumRef.current < revealThreshold) {
      scheduleAutoReset()
      return
    }

    const effective = accumRef.current - revealThreshold
    const span = Math.max(1, commitThreshold - revealThreshold)
    const progress = Math.min(1, effective / span)
    const ind = indicatorRef.current
    const icon = iconRef.current
    if (ind) {
      ind.style.transition = 'none'
      ind.style.transform = `translateY(${sign * dampedPullY(effective, span)}px)`
      ind.style.opacity = String(Math.min(1, progress + 0.15))
    }
    if (icon) icon.style.transform = `rotate(${progress * 360}deg)`
    if (accumRef.current >= commitThreshold) {
      commit()
    } else {
      scheduleAutoReset()
    }
  }

  /** スクロールしたときに呼ぶ(端に着いた時刻を覚え、着いたばかりの勢いを数えないため) */
  function noteScroll() {
    lastScrollRef.current = Date.now()
  }

  /** 指を離した: 確定していなければ戻す(確定して更新中なら、くるくるはそのまま) */
  function release() {
    if (!committingRef.current) collapse()
  }

  // ── 指(スマホ) ──
  // 指は本人がわざと引っぱっているので、ホイールのような「着いたばかりの勢い」の待ちや、出し始めのしきい値は置かない
  // (元の Web アプリのスマホ版と同じ)。引いた分だけすぐに印を出し、TOUCH_COMMIT_PX 以上引いて離したら更新する。
  // 同じスレを続けて更新しすぎないかは、更新する側(App)が見る
  const touchDistRef = useRef(0)

  /** 指で引いた量(端に着いてからの合計 px)を渡す */
  function touchPull(dist: number) {
    if (committingRef.current) return
    clearResetTimer()
    touchDistRef.current = dist
    const progress = Math.min(1, dist / TOUCH_COMMIT_PX)
    const ind = indicatorRef.current
    const icon = iconRef.current
    if (ind) {
      ind.style.transition = 'none'
      ind.style.transform = `translateY(${sign * dampedPullY(dist, TOUCH_COMMIT_PX)}px)`
      ind.style.opacity = String(Math.min(1, progress + 0.15))
    }
    if (icon) icon.style.transform = `rotate(${progress * 360}deg)`
  }

  /** 指を離した: 十分に引いていれば更新し、足りなければ戻す */
  function touchRelease() {
    const dist = touchDistRef.current
    touchDistRef.current = 0
    if (committingRef.current) return
    if (dist >= TOUCH_COMMIT_PX) {
      buzz()
      commit()
    }
    else collapse()
  }

  return { indicatorRef, iconRef, pull, reset: collapse, release, noteScroll, touchPull, touchRelease }
}

// hono-bbs-merge packages/web/src/hooks/useWheelPullRefresh.ts から複製
import { useRef } from 'react'
import {
  PULL_HIDDEN_Y,
  PULL_REVEAL_Y,
  PULL_SETTLE_TRANSITION,
  PULL_SNAP_TRANSITION,
  MIN_SPIN_MS,
  dampedPullY,
} from '../utils/pullRefresh'

interface UseWheelPullRefreshOptions {
  /** 実際の更新処理。Promiseを返せば、その完了とMIN_SPIN_MSの長い方を待ってから収納する */
  onRefresh: () => Promise<unknown> | void
  /** これ未満の累積量ではインジケーターすら出さない(誤反応防止・px相当) */
  revealThreshold?: number
  /** この量だけホイールで引っ張ると確定する(px相当の累積値) */
  commitThreshold?: number
  /** 上端用(下向きに現れる)なら1、下端用(上向きに現れる)なら-1 */
  sign?: 1 | -1
}

/**
 * PC版のホイールオーバースクロールによるプルリフレッシュ。
 * スマホのタッチ版(useSwipeGesture内のプル処理)と同じ見た目・タイミングになるよう
 * PULL_* 定数を共有する。1回のホイールイベントで即座に発火せず、revealThresholdに
 * 達するまではインジケーターも出さず、commitThresholdに達するまで累積させる。
 */
export function useWheelPullRefresh({
  onRefresh,
  revealThreshold = 200,
  commitThreshold = 400,
  sign = 1,
}: UseWheelPullRefreshOptions) {
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

  return { indicatorRef, iconRef, pull, reset: collapse }
}

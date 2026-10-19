// スワイプ(指でなぞる)の操作。hono-bbs(packages/web/src/hooks/useSwipeGesture.ts)から持ってきて、
// 感度を引数で受けるようにした。なぞった向きの並び(「right」「right,up」など)を、登録した操作に結びつける。
// - 最初に少し動いた時点で向きを決め、以後は一定以上ほかの向きへ動いたときだけ次の向きを足す(指のぶれで増えないように)
// - 指が 1 秒止まったらやめる。登録していない並びなら、離しても何もしない
// - 1 つの向きだけのときは、距離か速さが足りたときだけ確定する(スクロールのつもりの動きで発動しないように)
// - 登録した並びの途中なら、スクロールを止める
// - 指の動きは document で受ける(レスのポップアップ・スレ立てなど、body の直下に出した画面の上でなぞっても効くように)
import { useRef, useState } from 'react'

export type SwipeDirection = 'up' | 'down' | 'left' | 'right'

export interface SwipeBinding {
  /** なぞっている間、画面の真ん中に出す名前 */
  label?: string
  onCommit: () => void
}

/** キーは向きの並びを , でつないだもの(「right」「right,up」) */
export type SwipeMap = Record<string, SwipeBinding>

const LOCK_THRESHOLD = 8
const SEGMENT_THRESHOLD = 16
const IDLE_TIMEOUT_MS = 1000
const COMMIT_DISTANCE_RATIO = 0.4
const COMMIT_MIN_DISTANCE = 60
const COMMIT_MIN_VELOCITY = 0.5 // px/ms

/** 感度(1 = 鈍い 〜 5 = 敏感)を、しきい値に掛ける倍率にする。3 が標準 */
const SENSITIVITY: Record<number, number> = { 1: 1.6, 2: 1.3, 3: 1.0, 4: 0.7, 5: 0.45 }

const dominant = (dx: number, dy: number): SwipeDirection =>
  Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'down' : 'up'

const matchesPrefix = (map: SwipeMap, segs: SwipeDirection[]) => {
  const prefix = segs.join(',')
  return Object.keys(map).some((k) => k === prefix || k.startsWith(prefix + ','))
}

export function useSwipeGesture(map: SwipeMap, sensitivity = 3) {
  const [label, setLabel] = useState<string | null>(null)
  const start = useRef<{ x: number; y: number; time: number } | null>(null)
  const segStart = useRef<{ x: number; y: number } | null>(null)
  const segments = useRef<SwipeDirection[]>([])
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined)
  const cleanup = useRef<(() => void) | null>(null)
  const mult = SENSITIVITY[sensitivity] ?? 1

  const cancel = () => {
    start.current = null
    segStart.current = null
    segments.current = []
    clearTimeout(idle.current)
    setLabel(null)
  }
  const touchIdle = () => {
    clearTimeout(idle.current)
    idle.current = setTimeout(cancel, IDLE_TIMEOUT_MS)
  }

  const onTouchStart = (e: TouchEvent | React.TouchEvent) => {
    if (e.touches.length !== 1) return cancel()
    const t = e.touches[0]
    start.current = { x: t.clientX, y: t.clientY, time: Date.now() }
    segStart.current = { x: t.clientX, y: t.clientY }
    segments.current = []
    touchIdle()
    cleanup.current?.()
    const onMove = (ev: TouchEvent) => {
      if (!segStart.current) return
      touchIdle()
      const t2 = ev.touches[0]
      const dx = t2.clientX - segStart.current.x
      const dy = t2.clientY - segStart.current.y
      const dist = Math.hypot(dx, dy)
      const segs = segments.current
      if (segs.length === 0) {
        if (dist < LOCK_THRESHOLD * mult) return
        segs.push(dominant(dx, dy))
        segStart.current = { x: t2.clientX, y: t2.clientY }
        setLabel(map[segs.join(',')]?.label ?? null)
      } else if (dist >= SEGMENT_THRESHOLD * mult) {
        const dir = dominant(dx, dy)
        if (dir !== segs[segs.length - 1]) {
          segs.push(dir)
          setLabel(map[segs.join(',')]?.label ?? null)
        }
        segStart.current = { x: t2.clientX, y: t2.clientY }
      }
      // スクロールが始まってしまった後の touchmove は止められない(cancelable が false)ので、止められるときだけ止める。
      // 横向きで始まるなぞりは、呼ぶ側で touch-action: pan-y にしてあるので、ふつうはスクロールにならない
      if (segs.length >= 1 && ev.cancelable && matchesPrefix(map, segs)) ev.preventDefault()
    }
    document.addEventListener('touchmove', onMove, { passive: false })
    cleanup.current = () => document.removeEventListener('touchmove', onMove)
  }

  const onTouchEnd = (e: TouchEvent | React.TouchEvent) => {
    cleanup.current?.()
    cleanup.current = null
    clearTimeout(idle.current)
    const s = start.current
    const segs = segments.current
    start.current = null
    segStart.current = null
    segments.current = []
    setLabel(null)
    if (!s || segs.length === 0) return
    const binding = map[segs.join(',')]
    if (!binding) return
    if (segs.length > 1) return binding.onCommit()
    const t = e.changedTouches[0]
    const horizontal = segs[0] === 'left' || segs[0] === 'right'
    const distance = horizontal ? Math.abs(t.clientX - s.x) : Math.abs(t.clientY - s.y)
    const velocity = distance / Math.max(1, Date.now() - s.time)
    const viewport = horizontal ? window.innerWidth : window.innerHeight
    if (distance > viewport * COMMIT_DISTANCE_RATIO * mult || (distance > COMMIT_MIN_DISTANCE * mult && velocity > COMMIT_MIN_VELOCITY * mult)) binding.onCommit()
  }

  const onTouchCancel = () => {
    cleanup.current?.()
    cleanup.current = null
    cancel()
  }

  return { onTouchStart, onTouchEnd, onTouchCancel, label }
}

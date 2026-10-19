// スマホ: 長押し。指を置いたまま少し待つと呼ぶ(動かしたら、スクロールのつもりなのでやめる)。
// 長押しのあとの指を離したときのクリックは捨てる(長押しでメニューを出したのに、レスやスレも開いてしまわないように)。
// スマホの長押しでふつう出る、文字の選択・リンクのメニュー(contextmenu)も止める
import { useRef } from 'react'

const HOLD_MS = 450
const MOVE_PX = 10

export function useLongPress(onLongPress: (() => void) | undefined) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const start = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)
  if (!onLongPress) return {}
  const cancel = () => {
    clearTimeout(timer.current)
    start.current = null
  }
  return {
    onTouchStart: (e: React.TouchEvent) => {
      if (e.touches.length !== 1) return cancel()
      fired.current = false
      start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        fired.current = true
        start.current = null
        navigator.vibrate?.(15)
        onLongPress()
      }, HOLD_MS)
    },
    onTouchMove: (e: React.TouchEvent) => {
      const s = start.current
      if (s && Math.hypot(e.touches[0].clientX - s.x, e.touches[0].clientY - s.y) > MOVE_PX) cancel()
    },
    onTouchEnd: cancel,
    onTouchCancel: cancel,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClickCapture: (e: React.MouseEvent) => {
      if (!fired.current) return
      fired.current = false
      e.preventDefault()
      e.stopPropagation()
    },
  }
}

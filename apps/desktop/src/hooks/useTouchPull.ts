// スマホ: 指で引っぱって更新する(上の端で下へ、下の端で上へ)。今どきのチャットと同じ。
// 引っぱる量・くるくるの出し方・確定は、PC のホイールの引っぱり(useWheelPullRefresh)をそのまま使い、指の移動量を渡すだけ。
// 指の 1px はホイールの数 px に当たるので、scale を掛けて渡す(ホイールのしきい値 200 / 400 に、指の 50px / 100px ほどで届く)
import { useRef } from 'react'

interface Pull {
  pull: (delta: number) => void
  release: () => void
  reset: () => void
}

export function useTouchPull(scrollRef: React.RefObject<HTMLElement | null>, top: Pull | undefined, bottom: Pull | undefined, scale = 4) {
  const start = useRef<{ atTop: boolean; atBottom: boolean } | null>(null)
  const lastY = useRef(0)
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const el = scrollRef.current
      if (!el || e.touches.length !== 1) return
      start.current = { atTop: el.scrollTop < 1, atBottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 2 }
      lastY.current = e.touches[0].clientY
    },
    onTouchMove: (e: React.TouchEvent) => {
      const s = start.current
      if (!s) return
      const y = e.touches[0].clientY
      const dy = y - lastY.current
      lastY.current = y
      if (s.atTop && dy > 0) top?.pull(dy * scale)
      else if (s.atBottom && dy < 0) bottom?.pull(-dy * scale)
    },
    onTouchEnd: () => {
      start.current = null
      top?.release()
      bottom?.release()
    },
  }
}

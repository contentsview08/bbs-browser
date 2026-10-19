// スマホ: 指で引っぱって更新する(上の端で下へ、下の端で上へ)。今どきのチャットと同じ。
// くるくるの出し方・確定は useWheelPullRefresh の指用(touchPull・touchRelease)を使う。
// 端に着いたかは指を動かすたびに見る(同じ指のまま、スクロールして端に着き、そのまま引っぱっても効くように)
import { useRef } from 'react'

interface Pull {
  touchPull: (dist: number) => void
  touchRelease: () => void
}

export function useTouchPull(scrollRef: React.RefObject<HTMLElement | null>, top: Pull | undefined, bottom: Pull | undefined) {
  /** いま引っぱっている端と、端に着いてから引いた量 */
  const state = useRef<{ edge: 'top' | 'bottom' | null; dist: number; lastY: number }>({ edge: null, dist: 0, lastY: 0 })
  const end = () => {
    const s = state.current
    if (s.edge === 'top') top?.touchRelease()
    else if (s.edge === 'bottom') bottom?.touchRelease()
    s.edge = null
    s.dist = 0
  }
  return {
    onTouchStart: (e: React.TouchEvent) => {
      if (e.touches.length !== 1) return end()
      state.current = { edge: null, dist: 0, lastY: e.touches[0].clientY }
    },
    onTouchMove: (e: React.TouchEvent) => {
      const el = scrollRef.current
      if (!el || e.touches.length !== 1) return
      const s = state.current
      const y = e.touches[0].clientY
      const dy = y - s.lastY
      s.lastY = y
      if (!s.edge) {
        if (dy > 0 && top && el.scrollTop < 1) s.edge = 'top'
        else if (dy < 0 && bottom && el.scrollTop + el.clientHeight >= el.scrollHeight - 2) s.edge = 'bottom'
        else return
      }
      s.dist = Math.max(0, s.dist + (s.edge === 'top' ? dy : -dy))
      ;(s.edge === 'top' ? top : bottom)?.touchPull(s.dist)
      // 引き戻して 0 になったら、ふつうのスクロールに戻す
      if (s.dist === 0) s.edge = null
    },
    onTouchEnd: end,
    onTouchCancel: end,
  }
}

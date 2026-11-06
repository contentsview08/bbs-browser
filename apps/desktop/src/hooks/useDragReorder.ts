// つかんで動かして並べ替える(同じ大きさの項目の列。サイドバーのお気に入り板・タブの帯)
import { useRef, useState } from 'react'

/** これだけ動かしたらドラッグとみなす(px) */
const DRAG_PX = 4

/** axis: 動かす向き、size: 1 項目の大きさ(px)、onDrop: 別の位置で離したときに呼ぶ */
export function useDragReorder<K>(axis: 'x' | 'y', size: number, count: number, onDrop: (key: K, from: number, over: number) => void) {
  const [drag, setDrag] = useState<{ key: K; from: number; delta: number; over: number }>()
  /** ドラッグの直後の click を無視するための印 */
  const justDragged = useRef(false)
  const onDragMouseDown = (e: React.MouseEvent, key: K, index: number) => {
    // 枠の外で離したドラッグは click が来ないので、印が残っている
    justDragged.current = false
    if (e.button !== 0) return
    const start = axis === 'x' ? e.clientX : e.clientY
    let moved = false
    let latest = { key, from: index, delta: 0, over: index }
    const onMove = (ev: MouseEvent) => {
      const delta = (axis === 'x' ? ev.clientX : ev.clientY) - start
      if (!moved && Math.abs(delta) < DRAG_PX) return
      moved = true
      const over = Math.max(0, Math.min(count - 1, index + Math.round(delta / size)))
      latest = { key, from: index, delta, over }
      setDrag(latest)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setDrag(undefined)
      if (!moved) return
      justDragged.current = true
      if (latest.over !== latest.from) onDrop(key, latest.from, latest.over)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  /** ドラッグ中に、ほかの項目をどれだけずらすか(つかんだ項目の行き先を空ける) */
  const shiftOf = (i: number): number => {
    if (!drag) return 0
    if (drag.from < drag.over && i > drag.from && i <= drag.over) return -size
    if (drag.from > drag.over && i >= drag.over && i < drag.from) return size
    return 0
  }
  return { drag, justDragged, onDragMouseDown, shiftOf }
}

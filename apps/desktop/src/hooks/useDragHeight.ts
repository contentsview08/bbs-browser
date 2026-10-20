// 帯(ヘッダー・フッター)の高さを、端をつかんで変える。動かしている間はここだけで持ち、離したときに保存してもらう。
// 保存した値が 0 なら「既定の高さ」(配色・密度の設定のまま)。端をダブルクリックすると既定に戻す

import { useEffect, useState } from 'react'

export function useDragHeight(saved: number, save: (height: number) => void, limits: { min: number; max: number }) {
  const [height, setHeight] = useState(saved)
  useEffect(() => {
    setHeight(saved)
  }, [saved])

  /**
   * つかみ始め。current はいまの高さ(既定のときは測った値)。dir は下へ動かすと高くなるなら 1(ヘッダーの下端)、
   * 上へ動かすと高くなるなら -1(フッターの上端)
   */
  const startDrag = (e: React.MouseEvent, current: number, dir: 1 | -1) => {
    e.preventDefault()
    const startY = e.clientY
    let latest = current
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'row-resize'
    const onMove = (ev: MouseEvent) => {
      latest = Math.round(Math.min(limits.max, Math.max(limits.min, current + dir * (ev.clientY - startY))))
      setHeight(latest)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      save(latest)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  const reset = () => {
    setHeight(0)
    save(0)
  }
  return { height, startDrag, reset }
}

// PC のダイアログを「置いたまま使える窓」にする: 上の帯をつかんで動かし、右下の角をつかんで大きさを変える。
// 置き場所と大きさはこの端末のブラウザの保存に覚えておき、次に開いたときも同じ所・大きさで出す(消えても既定に戻るだけ)。
// 設定の窓(SettingsDialog)と同じ作り。ふつうのウィンドウと同じく、大きさを変えると左上の角は動かず、右と下へ広がる
import { useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'

export type DialogRect = { x: number; y: number; w: number; h: number }

export function useDialogRect(key: string, def: { w: number; h: number; minW: number; minH: number }) {
  /** 画面に収める: 上の帯(つかんで動かす所)がいつも見えるように、上は 8px から、左右・下も少しは画面に残す */
  const fit = (r: DialogRect): DialogRect => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const w = Math.min(Math.max(def.minW, r.w), vw - 16)
    const h = Math.min(Math.max(def.minH, r.h), vh - 16)
    return { w, h, x: Math.min(Math.max(8 - w + 120, r.x), vw - 120), y: Math.min(Math.max(8, r.y), vh - 48) }
  }
  const load = (): DialogRect => {
    const w = Math.min(def.w, window.innerWidth - 48)
    const h = Math.min(def.h, window.innerHeight - 48)
    const d = { x: (window.innerWidth - w) / 2, y: (window.innerHeight - h) / 2, w, h }
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? 'null') as DialogRect | null
      return fit(v && [v.x, v.y, v.w, v.h].every(Number.isFinite) ? v : d)
    } catch {
      return d
    }
  }
  const store = (r: DialogRect) => {
    try {
      localStorage.setItem(key, JSON.stringify(r))
    } catch {
      // 保存できなくても困らない(次は既定の大きさで開く)
    }
  }
  const [rect, setRect] = useState(load)
  const boxRef = useRef<HTMLDivElement>(null)
  /** 角で大きさを変えたあと(mouseup)に、いまの大きさを覚える */
  const saveSize = () => {
    const el = boxRef.current
    if (!el) return
    const next = { ...rect, w: el.offsetWidth, h: el.offsetHeight }
    if (next.w === rect.w && next.h === rect.h) return
    setRect(next)
    store(next)
  }
  /** 上の帯を押したら動かし始める(ボタンの上は除く) */
  const startMove = (e: ReactMouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, textarea, select')) return
    e.preventDefault()
    const sx = e.clientX - rect.x
    const sy = e.clientY - rect.y
    let last = rect
    const move = (ev: MouseEvent) => {
      last = fit({ ...last, x: ev.clientX - sx, y: ev.clientY - sy })
      setRect(last)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      store(last)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  /** 窓の箱に付ける style(置き場所・大きさ・右下の角で変えられる。画面の外にはみ出さない) */
  const style: CSSProperties = {
    left: rect.x,
    top: rect.y,
    width: rect.w,
    height: rect.h,
    minWidth: def.minW,
    minHeight: def.minH,
    maxWidth: `calc(100vw - ${Math.max(0, rect.x)}px - 8px)`,
    maxHeight: `calc(100vh - ${rect.y}px - 8px)`,
    resize: 'both',
  }
  return { rect, boxRef, style, startMove, saveSize }
}

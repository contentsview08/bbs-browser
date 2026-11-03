// PC: マウスジェスチャー。Ctrl を押しながら(または右ボタンを押しながら)マウスを動かした向きの並び(「right」「right,up」など)を、
// 登録した操作に結びつける。向きの読み取り方はスマホのスワイプ(useSwipeGesture)と同じ:
// 少し動いたら最初の向きを決め、そのあとは一定以上ほかの向きへ動いたときだけ次の向きを足す(手のぶれで増えないように)。
// - Ctrl のとき: Ctrl を離した時点で確定する。Ctrl を押したまま別のキーを押したら(Ctrl+C など)ジェスチャーにはしない
// - 右ボタンのとき: 右ボタンを離した時点で確定する。動かしていたら、離したときのコンテキストメニューは出さない
// - 動きは document で受ける(レスのポップアップ・スレ立てなど、body の直下に出した画面の上でも効くように)
// - 入力欄の中で始めた右ボタンのなぞりは、文字を選ぶためのものなので取らない
import { useEffect, useRef, useState } from 'react'
import type { SwipeDirection } from './useSwipeGesture'
import type { MouseGestureTrigger } from '../ui/settings'

export interface MouseGestureBinding {
  /** 動かしている間、画面の真ん中に出す名前 */
  label?: string
  onCommit: () => void
}

/** キーは向きの並びを , でつないだもの(「right」「right,up」) */
export type MouseGestureMap = Record<string, MouseGestureBinding>

/** 最初の向きを決めるまでの距離(px) */
const LOCK_PX = 16
/** 次の向きを足すのに要る距離(px) */
const SEGMENT_PX = 32
/** 覚えられる向きの数(設定の画面で覚えさせるときと同じ) */
export const MOUSE_MAX_SEGMENTS = 3

const ARROW: Record<SwipeDirection, string> = { right: '→', left: '←', up: '↑', down: '↓' }

const dominant = (dx: number, dy: number): SwipeDirection => (Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'down' : 'up')

/**
 * @param map 向きの並び → 操作
 * @param trigger 何を押しながら動かすか
 * @param enabled 使うか(スマホでは使わない)
 * @returns label: 動かしている間に出す文字(矢印と操作の名前)。何もなぞっていなければ null
 */
export function useMouseGesture(map: MouseGestureMap, trigger: MouseGestureTrigger, enabled: boolean) {
  const [label, setLabel] = useState<string | null>(null)
  // 設定が変わっても、document のリスナーを付け直さなくて済むように、いまの値を ref で持つ
  const mapRef = useRef(map)
  mapRef.current = map
  const triggerRef = useRef(trigger)
  triggerRef.current = trigger

  useEffect(() => {
    if (!enabled) return
    /** なぞっている途中の状態。null なら何もしていない */
    let st: { origin: { x: number; y: number } | null; segStart: { x: number; y: number } | null; segs: SwipeDirection[]; spoiled: boolean } | null = null
    /** 右ボタンのなぞりで操作したあと、続けて来るコンテキストメニューを 1 回だけ止める */
    let eatContextMenu = false

    const show = () => {
      const s = st
      if (!s || s.segs.length === 0 || s.spoiled) return setLabel(null)
      const arrows = s.segs.map((d) => ARROW[d]).join('')
      const name = mapRef.current[s.segs.join(',')]?.label
      setLabel(name ? `${arrows}  ${name}` : arrows)
    }
    const begin = (x: number | null, y: number | null) => {
      st = { origin: x === null || y === null ? null : { x, y }, segStart: x === null || y === null ? null : { x, y }, segs: [], spoiled: false }
    }
    const reset = () => {
      st = null
      setLabel(null)
    }
    /** 離したとき: 登録した並びなら実行する。動かしていたら true */
    const finish = (): boolean => {
      const s = st
      reset()
      if (!s || s.segs.length === 0 || s.spoiled) return false
      mapRef.current[s.segs.join(',')]?.onCommit()
      return true
    }

    const onMove = (e: MouseEvent) => {
      const s = st
      if (!s) return
      // Ctrl のときは、Ctrl を押してから最初に動いた所を始点にする
      if (!s.origin || !s.segStart) {
        s.origin = { x: e.clientX, y: e.clientY }
        s.segStart = { x: e.clientX, y: e.clientY }
        return
      }
      // 右ボタンのときに、ボタンを離したのを取りこぼしていたら(画面の外で離したなど)やめる
      if (triggerRef.current === 'right' && (e.buttons & 2) === 0) return reset()
      const dx = e.clientX - s.segStart.x
      const dy = e.clientY - s.segStart.y
      const dist = Math.hypot(dx, dy)
      if (s.segs.length === 0) {
        if (dist < LOCK_PX) return
        s.segs = [dominant(dx, dy)]
        s.segStart = { x: e.clientX, y: e.clientY }
      } else if (dist >= SEGMENT_PX) {
        const d = dominant(dx, dy)
        if (d !== s.segs[s.segs.length - 1] && s.segs.length < MOUSE_MAX_SEGMENTS) s.segs = [...s.segs, d]
        s.segStart = { x: e.clientX, y: e.clientY }
      } else return
      show()
    }

    // ── Ctrl を押しながら ──
    const onKeyDown = (e: KeyboardEvent) => {
      if (triggerRef.current !== 'ctrl') return
      if (e.key === 'Control') {
        if (!e.repeat && !st) begin(null, null)
        return
      }
      // Ctrl を押したまま別のキー(Ctrl+C など)を押したら、このあと離してもジェスチャーにしない
      if (st && e.ctrlKey) {
        st.spoiled = true
        setLabel(null)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (triggerRef.current !== 'ctrl') return
      if (e.key === 'Control') finish()
    }

    /** Ctrl を押したままクリック・ホイール(Ctrl+クリックで開く、Ctrl+ホイールで拡大など)をしたら、ジェスチャーにしない */
    const spoil = () => {
      if (triggerRef.current === 'ctrl' && st) {
        st.spoiled = true
        setLabel(null)
      }
    }

    // ── 右ボタンを押しながら ──
    const onMouseDown = (e: MouseEvent) => {
      spoil()
      if (triggerRef.current !== 'right' || e.button !== 2) return
      // 入力欄の中は、右ボタンで文字を選ぶ・貼り付けるためのもの
      if ((e.target as Element | null)?.closest?.('input, textarea, [contenteditable]')) return
      begin(e.clientX, e.clientY)
    }
    const onMouseUp = (e: MouseEvent) => {
      if (triggerRef.current !== 'right' || e.button !== 2 || !st) return
      // 動かしていたら(操作の有無によらず)コンテキストメニューは出さない。動かしていなければふつうのメニュー
      const moved = st.segs.length > 0 && !st.spoiled
      finish()
      eatContextMenu = moved
    }
    const onContextMenu = (e: MouseEvent) => {
      if (!eatContextMenu) return
      eatContextMenu = false
      e.preventDefault()
      e.stopPropagation()
    }
    const onBlur = () => reset()

    document.addEventListener('mousemove', onMove, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('mouseup', onMouseUp, true)
    document.addEventListener('contextmenu', onContextMenu, true)
    document.addEventListener('wheel', spoil, { capture: true, passive: true })
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('mousemove', onMove, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('mouseup', onMouseUp, true)
      document.removeEventListener('contextmenu', onContextMenu, true)
      document.removeEventListener('wheel', spoil, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [enabled])

  return { label }
}

// PC: マウスジェスチャー(パイメニュー)。Ctrl を押しながら(または右ボタンを押しながら)マウスを少し動かすと、画面の真ん中に
// 8 方向の円盤(MouseGesturePie)が大きく半透明で出て、ポインターは隠れる。向きは「動かし始めた所からどちらへ動いたか」で決める
// (ポインターが画面のどこにあっても、円盤の中心を起点にしたのと同じ)。向いている区画が光り、Ctrl(右ボタン)を離すとその区画の操作をする。
// 起点の近く(DEAD_PX の中)に戻して離せば何もしない。
// - Ctrl のとき: Ctrl を押したまま別のキー(Ctrl+C など)・クリック・ホイールをしたらジェスチャーにしない
// - 右ボタンのとき: 動かしていたら、離したときのコンテキストメニューは出さない。入力欄の中で始めた右ボタンは取らない(文字を選ぶ・貼り付けるためのもの)
// - 動きは document で受ける(レスのポップアップ・スレ立てなど、body の直下に出した画面の上でも効くように)
import { useEffect, useRef, useState } from 'react'
import type { MouseGestureTrigger } from '../ui/settings'

/** 8 方向(時計回りに 上 から) */
export type PieDir = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'
export const PIE_DIRS: PieDir[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']
export const PIE_DIR_NAMES: Record<PieDir, string> = { n: '上', ne: '右上', e: '右', se: '右下', s: '下', sw: '左下', w: '左', nw: '左上' }

export interface MouseGestureBinding {
  /** 区画に出す名前 */
  label?: string
  onCommit: () => void
}

/** 方向 → 操作(割り当てのない方向は入れない) */
export type MouseGestureMap = Partial<Record<PieDir, MouseGestureBinding>>

/** 円盤を出すまでの動き(px) */
const SHOW_PX = 8
/** 中心のこの半径の中では、どの区画でもない(離しても何もしない) */
export const DEAD_PX = 28

/** 中心からの向きを 8 方向にする。中心の近くなら null */
export function pieDirOf(dx: number, dy: number): PieDir | null {
  if (Math.hypot(dx, dy) < DEAD_PX) return null
  // 上を 0° として時計回り。45° ごとに区画、区画の真ん中が方向になるように 22.5° ずらす
  const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360 + 22.5) % 360
  return PIE_DIRS[Math.floor(deg / 45)]
}

export interface PieState {
  /** 動かし始めた所(画面の座標)。円盤の上の丸は、ここからの動きで overlay が自分で動かす(mousemove ごとに React を通すと遅れる) */
  x: number
  y: number
  /** いま向いている区画。起点の近くなら null */
  dir: PieDir | null
}

/**
 * @param map 方向 → 操作
 * @param trigger 何を押しながら動かすか
 * @param enabled 使うか(スマホでは使わない)
 * @returns pie: 円盤を出している間の中心と向き。出していなければ null
 */
export function useMouseGesture(map: MouseGestureMap, trigger: MouseGestureTrigger, enabled: boolean) {
  const [pie, setPie] = useState<PieState | null>(null)
  // 設定が変わっても document のリスナーを付け直さなくて済むように、いまの値を ref で持つ
  const mapRef = useRef(map)
  mapRef.current = map
  const triggerRef = useRef(trigger)
  triggerRef.current = trigger

  useEffect(() => {
    if (!enabled) return
    /** 押している途中の状態。null なら何もしていない。origin は動かし始めた所(Ctrl のときは押してから最初に動いた所) */
    let st: { origin: { x: number; y: number } | null; shown: boolean; dir: PieDir | null; spoiled: boolean } | null = null
    /** 右ボタンのなぞりで円盤を出したあと、続けて来るコンテキストメニューを 1 回だけ止める */
    let eatContextMenu = false
    /** 円盤を出しているか(state に出したか) */
    let pieShown = false

    const begin = (x: number | null, y: number | null) => {
      st = { origin: x === null || y === null ? null : { x, y }, shown: false, dir: null, spoiled: false }
    }
    const reset = () => {
      st = null
      pieShown = false
      setPie(null)
    }
    /** 離したとき: 向いている区画の操作をする。円盤を出していたら true */
    const finish = (): boolean => {
      const s = st
      reset()
      if (!s || !s.shown || s.spoiled) return false
      if (s.dir) mapRef.current[s.dir]?.onCommit()
      return true
    }
    /** Ctrl を押したままクリック・ホイール・別のキーをしたら、ジェスチャーにしない */
    const spoil = () => {
      if (triggerRef.current === 'ctrl' && st) {
        st.spoiled = true
        setPie(null)
      }
    }

    const onMove = (e: MouseEvent) => {
      const s = st
      if (!s || s.spoiled) return
      if (!s.origin) {
        s.origin = { x: e.clientX, y: e.clientY }
        return
      }
      // 右ボタンのときに、ボタンを離したのを取りこぼしていたら(画面の外で離したなど)やめる
      if (triggerRef.current === 'right' && (e.buttons & 2) === 0) return reset()
      const dx = e.clientX - s.origin.x
      const dy = e.clientY - s.origin.y
      if (!s.shown) {
        if (Math.hypot(dx, dy) < SHOW_PX) return
        s.shown = true
      }
      // state を変えるのは、円盤を出すときと向きが変わったときだけ(動くたびに App を描き直すと丸が遅れる)
      const dir = pieDirOf(dx, dy)
      const first = s.dir === null && !pieShown
      if (dir === s.dir && !first) return
      s.dir = dir
      pieShown = true
      setPie({ x: s.origin.x, y: s.origin.y, dir })
    }

    // ── Ctrl を押しながら ──
    const onKeyDown = (e: KeyboardEvent) => {
      if (triggerRef.current !== 'ctrl') return
      if (e.key === 'Control') {
        if (!e.repeat && !st) begin(null, null)
        return
      }
      if (st && e.ctrlKey) spoil()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (triggerRef.current !== 'ctrl') return
      if (e.key === 'Control') finish()
    }

    // ── 右ボタンを押しながら ──
    const onMouseDown = (e: MouseEvent) => {
      spoil()
      if (triggerRef.current !== 'right' || e.button !== 2) return
      if ((e.target as Element | null)?.closest?.('input, textarea, [contenteditable]')) return
      begin(e.clientX, e.clientY)
    }
    const onMouseUp = (e: MouseEvent) => {
      if (triggerRef.current !== 'right' || e.button !== 2 || !st) return
      // 円盤を出していたら(操作の有無によらず)コンテキストメニューは出さない。出していなければふつうのメニュー
      eatContextMenu = finish()
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

  return { pie }
}

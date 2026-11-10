// 1 つを選ぶ、つながった切り替えボタン(セグメント)。1 本の枠に選択肢を並べ、選んでいる所に差し色の「つまみ」を乗せる。
// 選び直すと、つまみが横へ滑る(OS・設定の「動きを減らす」のときは app.css の決まりで動かさない)。
// 幅の決め方・寸法はスマホ版の ui/Segmented.kt と同じ(決まりは bbs-suite の docs/style-tree.md の「切り替えボタン」):
// 等分で収まれば等分、無理なら字の幅に余りを均等に足す。それでも入らなければ字を 1 ずつ下げ、下限でも入らなければ横に流す(折り返さない・切らない)

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { isMobile } from '../utils/platform'

/** 寸法(px)。h: 枠の高さ(線を含む)・inset: 枠とつまみの間・r: 枠の角・rThumb: つまみの角・font: 字・min: 下げる下限・px: 1 つの選択肢の左右の余白 */
const DIM = isMobile ? { h: 36, inset: 3, r: 10, rThumb: 7, font: 13, min: 11, px: 10 } : { h: 30, inset: 3, r: 8, rThumb: 5, font: 12, min: 10, px: 10 }

/** equal: 等分 / content: 字の幅 + 余りを均等 / scroll: 収まらないので横に流す */
type Layout = { font: number; mode: 'equal' | 'content' | 'scroll' }
type Thumb = { x: number; w: number; slide: boolean }

export function Segmented<T extends string | number>(props: {
  /** 読み上げの名前(見出しと同じ言葉) */
  label: string
  value: T
  options: { key: T; name: string; note?: string }[]
  onChange: (v: T) => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<Layout>({ font: DIM.font, mode: 'equal' })
  const [thumb, setThumb] = useState<Thumb | null>(null)
  const index = props.options.findIndex((o) => o.key === props.value)
  const indexRef = useRef(index)
  const shownRef = useRef<number | null>(null)
  const names = props.options.map((o) => o.name).join('\n')

  /** 選んでいる所の位置につまみを置く。slide: 選び直したときだけ滑らせる(開いたとき・幅が変わったときは、その場に置く) */
  const place = (slide: boolean) => {
    const b = boxRef.current?.querySelectorAll<HTMLElement>('[role="radio"]')[indexRef.current]
    setThumb(b ? { x: b.offsetLeft, w: b.offsetWidth, slide } : null)
  }

  // 幅に合わせて並べ方と字の大きさを決める。字は太字の見本(data-seg-text)で測る(選んだ所だけ太くしても幅が変わらないように)
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    const fit = () => {
      const buttons = [...box.querySelectorAll<HTMLElement>('[role="radio"]')]
      if (!buttons.length || !box.offsetWidth) return
      // 窓の zoom の分は割り戻す(Range の幅は zoom を含むため)
      const zoom = box.getBoundingClientRect().width / box.offsetWidth || 1
      const range = document.createRange()
      const avail = box.clientWidth - DIM.inset * 2
      const needs = (f: number) =>
        buttons.map((b) => {
          b.style.fontSize = `${f}px`
          range.selectNodeContents(b.querySelector('[data-seg-text]') ?? b)
          return Math.ceil(range.getBoundingClientRect().width / zoom) + DIM.px * 2
        })
      let next: Layout = { font: DIM.min, mode: 'scroll' }
      for (let f = DIM.font; f >= DIM.min; f--) {
        const need = needs(f)
        if (Math.max(...need) * need.length <= avail) next = { font: f, mode: 'equal' }
        else if (need.reduce((a, b) => a + b, 0) <= avail) next = { font: f, mode: 'content' }
        else continue
        break
      }
      // 測るために変えた字の大きさを、決めた大きさに戻す(React の値が同じだと書き戻されないため)
      for (const b of buttons) b.style.fontSize = `${next.font}px`
      setLayout((l) => (l.font === next.font && l.mode === next.mode ? l : next))
    }
    fit()
    const ro = new ResizeObserver(() => {
      fit()
      place(false)
    })
    ro.observe(box)
    // 字の形(フォント)が後から届くと字の幅が変わるので、測り直す
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined
    const onFonts = () => {
      fit()
      place(false)
    }
    fonts?.addEventListener('loadingdone', onFonts)
    return () => {
      ro.disconnect()
      fonts?.removeEventListener('loadingdone', onFonts)
    }
  }, [names])

  useLayoutEffect(() => {
    indexRef.current = index
    const moved = shownRef.current !== null && shownRef.current !== index
    shownRef.current = index
    place(moved)
  }, [index, layout, names])

  // 横に流しているときは、選んだ所が見えるように寄せる
  useLayoutEffect(() => {
    const box = boxRef.current
    if (layout.mode !== 'scroll' || !box || !thumb) return
    box.scrollTo({ left: Math.max(0, thumb.x - 24), behavior: thumb.slide ? 'smooth' : 'auto' })
  }, [layout.mode, thumb])

  const pick = (i: number, focus: boolean) => {
    const o = props.options[i]
    if (!o) return
    if (o.key !== props.value) props.onChange(o.key)
    // キーで選んだときだけ、選んだ所へフォーカスを移す(押したときに枠の線が出ないように)
    if (focus) boxRef.current?.querySelectorAll<HTMLElement>('[role="radio"]')[i]?.focus()
  }
  // ←→(↑↓ も)・Home・End で選ぶ。後ろの画面のキー操作には渡さない
  const onKeyDown = (e: KeyboardEvent) => {
    const n = props.options.length
    const at = index < 0 ? 0 : index
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (at + 1) % n : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (at - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1
    if (next < 0) return
    e.preventDefault()
    e.stopPropagation()
    pick(next, true)
  }

  const flex = layout.mode === 'equal' ? '1 1 0' : layout.mode === 'content' ? '1 0 auto' : '0 0 auto'
  return (
    <div
      ref={boxRef}
      role="radiogroup"
      aria-label={props.label}
      onKeyDown={onKeyDown}
      className={`seg relative flex w-full ${layout.mode === 'scroll' ? 'overflow-x-auto no-scrollbar' : 'overflow-hidden'}`}
      style={{ height: DIM.h, padding: DIM.inset, borderRadius: DIM.r }}
    >
      {thumb && (
        <span
          aria-hidden
          className="seg-thumb absolute"
          data-slide={thumb.slide ? '' : undefined}
          style={{ left: 0, top: DIM.inset, bottom: DIM.inset, width: thumb.w, transform: `translateX(${thumb.x}px)`, borderRadius: DIM.rThumb }}
        />
      )}
      {props.options.map((o, i) => {
        const on = i === index
        return (
          <button
            key={String(o.key)}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on || (index < 0 && i === 0) ? 0 : -1}
            title={isMobile ? undefined : o.note}
            onClick={() => pick(i, false)}
            data-on={on ? '' : undefined}
            className="seg-btn relative h-full grid place-items-center whitespace-nowrap leading-none"
            style={{ flex, padding: `0 ${DIM.px}px`, borderRadius: DIM.rThumb, fontSize: layout.font }}
          >
            {/* 太字の見本(見えない)で幅を取り、その上に字を重ねる */}
            <span data-seg-text aria-hidden className="col-start-1 row-start-1 font-bold invisible">
              {o.name}
            </span>
            <span className="col-start-1 row-start-1">{o.name}</span>
          </button>
        )
      })}
    </div>
  )
}

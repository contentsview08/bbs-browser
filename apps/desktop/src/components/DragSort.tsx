// 指(マウス)でつまんで並べ替える部品(設定の画面)。
// - DragList: 1 列の並びの順番を変える(スレ一覧のタブの並びなど)
// - DragZones: いくつかの箱のあいだで動かす(ボタンを ヘッダー・フッター・︙ のどこに置くか)
// どちらも、行の「つまみ」(handle)をつかんで動かす。つまみの上では、スクロールやジェスチャーが動かない(touch-action: none)。
// つかんでいる行は指に付いて動き、離した所で決まる
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

/** つまみに付ける見た目(行の右に置く ≡ ) */
export function DragHandle(props: { handle: HandleProps }) {
  return (
    <span
      {...props.handle}
      data-drag-handle
      className="flex-shrink-0 w-10 h-10 -my-2 -mr-2 flex items-center justify-center text-c-text-muted cursor-grab active:cursor-grabbing"
      style={{ touchAction: 'none' }}
      title="つまんで動かす"
    >
      <span className="material-symbols-outlined text-xl">drag_indicator</span>
    </span>
  )
}

type HandleProps = {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onPointerCancel: (e: React.PointerEvent) => void
}

/** つかんでいる行の見た目(浮かせて、指に付いて動かす) */
const lifted = (dx: number, dy: number): CSSProperties => ({
  transform: `translate(${dx}px, ${dy}px) scale(1.02)`,
  zIndex: 10,
  position: 'relative',
  boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
})

/** 1 列の並びの順番を、つまんで変える */
export function DragList<K extends string>(props: {
  items: K[]
  render: (key: K, handle: HandleProps, dragging: boolean) => ReactNode
  onChange: (items: K[]) => void
}) {
  const rows = useRef(new Map<K, HTMLElement>())
  /** つかんでいる行・いまの並び・指の高さ・行の中のつかんだ高さ */
  const [drag, setDrag] = useState<{ key: K; order: K[]; y: number; grab: number }>()
  const order = drag?.order ?? props.items
  // 並びを入れ替えたあとの行の場所から測り直して、つかんだ行を指の高さに合わせる
  useLayoutEffect(() => {
    if (!drag) return
    const el = rows.current.get(drag.key)
    if (!el) return
    el.style.transform = 'none'
    const top = el.getBoundingClientRect().top
    el.style.transform = `translateY(${drag.y - drag.grab - top}px) scale(1.02)`
  })
  const handleFor = (key: K): HandleProps => ({
    onPointerDown: (e) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      const top = rows.current.get(key)?.getBoundingClientRect().top ?? e.clientY
      setDrag({ key, order: props.items, y: e.clientY, grab: e.clientY - top })
    },
    onPointerMove: (e) => {
      if (!drag || drag.key !== key) return
      // 指の高さが、ほかの行の真ん中を越えたら、その行と入れ替える
      const y = e.clientY
      const others = drag.order.filter((k) => k !== key)
      let index = others.length
      for (let i = 0; i < others.length; i++) {
        const r = rows.current.get(others[i])?.getBoundingClientRect()
        if (r && y < r.top + r.height / 2) {
          index = i
          break
        }
      }
      setDrag({ ...drag, order: [...others.slice(0, index), key, ...others.slice(index)], y })
    },
    onPointerUp: () => {
      const el = drag && rows.current.get(drag.key)
      if (el) el.style.transform = ''
      if (drag && drag.order.join() !== props.items.join()) props.onChange(drag.order)
      setDrag(undefined)
    },
    onPointerCancel: () => {
      const el = drag && rows.current.get(drag.key)
      if (el) el.style.transform = ''
      setDrag(undefined)
    },
  })
  return (
    <div className="flex flex-col gap-1.5">
      {order.map((k) => {
        const dragging = drag?.key === k
        return (
          <div
            key={k}
            ref={(el) => {
              if (el) rows.current.set(k, el)
              else rows.current.delete(k)
            }}
            style={dragging ? { position: 'relative', zIndex: 10, boxShadow: '0 6px 20px rgba(0,0,0,0.25)', borderRadius: 12 } : undefined}
          >
            {props.render(k, handleFor(k), dragging)}
          </div>
        )
      })}
    </div>
  )
}

/** いくつかの箱のあいだで、つまんで動かす(離した所の箱の、離した高さの位置に入れる。同じ箱の中での並べ替えもできる) */
export function DragZones<Z extends string>(props: {
  zones: { key: Z; title: string; note?: string; items: string[] }[]
  render: (id: string, handle: HandleProps, dragging: boolean) => ReactNode
  /** index は、動かした先の箱の中で何番目に入れるか(動かしたもの自身を除いて数える) */
  onMove: (id: string, zone: Z, index: number) => void
}) {
  const boxes = useRef(new Map<Z, HTMLElement>())
  const rows = useRef(new Map<string, HTMLElement>())
  /** 箱の中の、指の高さより上にあるもの(自分を除く)の数 = 入れる位置 */
  const indexIn = (zone: Z, id: string, y: number) =>
    (props.zones.find((z) => z.key === zone)?.items ?? [])
      .filter((x) => x !== id)
      .filter((x) => {
        const r = rows.current.get(x)?.getBoundingClientRect()
        return r !== undefined && r.top + r.height / 2 < y
      }).length
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; dx: number; dy: number; over?: Z }>()
  const zoneAt = (x: number, y: number) => {
    for (const [key, el] of boxes.current) {
      const r = el.getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return key
    }
    return undefined
  }
  const handleFor = (id: string): HandleProps => ({
    onPointerDown: (e) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      setDrag({ id, x: e.clientX, y: e.clientY, dx: 0, dy: 0 })
    },
    onPointerMove: (e) => {
      if (!drag || drag.id !== id) return
      setDrag({ ...drag, dx: e.clientX - drag.x, dy: e.clientY - drag.y, over: zoneAt(e.clientX, e.clientY) })
    },
    onPointerUp: (e) => {
      const z = zoneAt(e.clientX, e.clientY)
      if (drag && z && (Math.abs(drag.dx) > 4 || Math.abs(drag.dy) > 4)) props.onMove(id, z, indexIn(z, id, e.clientY))
      setDrag(undefined)
    },
    onPointerCancel: () => setDrag(undefined),
  })
  return (
    <div className="flex flex-col gap-4">
      {props.zones.map((z) => (
        <div key={z.key}>
          <p className="mb-1.5 text-xs font-bold text-c-text-muted">
            {z.title}
            {z.note && <span className="ml-2 font-normal">{z.note}</span>}
          </p>
          <div
            ref={(el) => {
              if (el) boxes.current.set(z.key, el)
              else boxes.current.delete(z.key)
            }}
            className={`min-h-[56px] flex flex-col gap-1.5 p-2 rounded-xl border-2 border-dashed transition-colors ${
              drag?.over === z.key ? 'border-c-accent bg-[var(--c-accent-wash)]' : 'border-c-border'
            }`}
          >
            {z.items.length === 0 && <p className="py-2 text-center text-xs text-c-text-muted">ここに動かすと、{z.title}に置きます</p>}
            {z.items.map((id) => (
              <div
                key={id}
                ref={(el) => {
                  if (el) rows.current.set(id, el)
                  else rows.current.delete(id)
                }}
                style={drag?.id === id ? lifted(drag.dx, drag.dy) : undefined}
              >
                {props.render(id, handleFor(id), drag?.id === id)}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

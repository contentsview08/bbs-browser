// 指でつまんで並べ替える部品(スマホの設定)。
// - DragList: 1 列の並びの順番を変える(スレ一覧のタブの並びなど)
// - DragZones: いくつかの箱のあいだで動かす(ボタンを ヘッダー・フッター・︙ のどこに・何番目に置くか)
// つかみ方: 行のどこでも長押し(LONG_MS)するか、右のつまみ(≡)に触れればすぐ。
// つかんでいる間は、ほかの行がよけて、置く所がその場で分かる(箱をまたぐときも、移る先の箱にその場で入る)。
// つかんでいる行は指に付いて動き、離した所で決まる。つかんでいる間は画面をスクロールさせない
import { buzz } from '../utils/haptics'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

const LONG_MS = 300
const SLOP = 8

type HandleProps = { onPointerDown: (e: React.PointerEvent) => void }

/** つまみ(行の右の ≡)。触れるとすぐつかめる */
export function DragHandle(props: { handle: HandleProps }) {
  return (
    <span
      {...props.handle}
      data-drag-handle
      className="flex-shrink-0 w-10 h-10 -my-2 -mr-2 flex items-center justify-center text-c-text-muted"
      style={{ touchAction: 'none' }}
      title="つまんで動かす"
    >
      <span className="material-symbols-outlined text-xl">drag_indicator</span>
    </span>
  )
}

interface ZoneDef<Z extends string> {
  key: Z
  title: string
  note?: string
  items: string[]
}

interface Drag<Z> {
  id: string
  zone: Z
  index: number
  /** 指の位置と、行の中のつかんだ位置 */
  x: number
  y: number
  grabX: number
  grabY: number
}

/** 並べ替えの中身(DragList・DragZones の共通) */
function useDragSort<Z extends string>(zones: ZoneDef<Z>[], onDrop: (id: string, zone: Z, index: number) => void) {
  const rows = useRef(new Map<string, HTMLElement>())
  const boxes = useRef(new Map<Z, HTMLElement>())
  const [drag, setDrag] = useState<Drag<Z>>()
  const dragRef = useRef(drag)
  dragRef.current = drag
  const zonesRef = useRef(zones)
  zonesRef.current = zones
  const dropRef = useRef(onDrop)
  dropRef.current = onDrop

  /** いま見せる並び(つかんでいるものを、置く所へ動かしたもの) */
  const shown = (): ZoneDef<Z>[] => {
    const d = drag
    if (!d) return zones
    return zones.map((z) => {
      const items = z.items.filter((x) => x !== d.id)
      if (z.key === d.zone) items.splice(Math.min(d.index, items.length), 0, d.id)
      return { ...z, items }
    })
  }

  const dragging = drag !== undefined
  // 指の動き(つかんでいる間だけ、画面全体で受ける。スクロールは止める)
  useEffect(() => {
    if (!dragging) return
    // つかんでいる間の印(画面全体のジェスチャーは、これを見て止まる。右へ動かして「戻る」にならないように)
    document.body.dataset.dragSorting = ''
    const move = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const { clientX: x, clientY: y } = e
      // 指のある箱(箱の外なら、いちばん近い箱)
      let zone = d.zone
      let best = Infinity
      for (const [key, el] of boxes.current) {
        const r = el.getBoundingClientRect()
        const dist = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0
        if (dist < best) {
          best = dist
          zone = key
        }
      }
      // その箱の中で、指より上にある行の数 = 置く所
      const items = (zonesRef.current.find((z) => z.key === zone)?.items ?? []).filter((id) => id !== d.id)
      const index = items.filter((id) => {
        const r = rows.current.get(id)?.getBoundingClientRect()
        return r !== undefined && r.top + r.height / 2 < y
      }).length
      setDrag({ ...d, x, y, zone, index })
    }
    const up = () => {
      const d = dragRef.current
      if (d) dropRef.current(d.id, d.zone, d.index)
      setDrag(undefined)
    }
    const cancel = () => setDrag(undefined)
    const noScroll = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    document.addEventListener('touchmove', noScroll, { passive: false })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      document.removeEventListener('touchmove', noScroll)
      delete document.body.dataset.dragSorting
    }
  }, [dragging])

  // つかんでいる行を、並べ替えたあとの場所から測って、指の位置に合わせる
  useLayoutEffect(() => {
    if (!drag) return
    const el = rows.current.get(drag.id)
    if (!el) return
    el.style.transform = 'none'
    const r = el.getBoundingClientRect()
    el.style.transform = `translate(${drag.x - drag.grabX - r.left}px, ${drag.y - drag.grabY - r.top}px) scale(1.03)`
  })
  // 離したら、指に合わせた位置を外す
  useEffect(() => {
    if (dragging) return
    for (const el of rows.current.values()) el.style.transform = ''
  }, [dragging])

  /** id の行をつかむ(指の位置から) */
  const start = (id: string, x: number, y: number) => {
    const r = rows.current.get(id)?.getBoundingClientRect()
    const zone = zonesRef.current.find((z) => z.items.includes(id))
    if (!r || !zone) return
    buzz(10)
    setDrag({ id, zone: zone.key, index: zone.items.indexOf(id), x, y, grabX: x - r.left, grabY: y - r.top })
  }

  /** つまみ: 触れたらすぐつかむ */
  const handleFor = (id: string): HandleProps => ({
    onPointerDown: (e) => {
      e.preventDefault()
      e.stopPropagation()
      start(id, e.clientX, e.clientY)
    },
  })

  /** 行: 長押しでつかむ(その前に動かしたら、スクロールのつもりなのでやめる) */
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number }>(undefined)
  const rowProps = (id: string) => ({
    ref: (el: HTMLDivElement | null) => {
      if (el) rows.current.set(id, el)
      else rows.current.delete(id)
    },
    onPointerDown: (e: React.PointerEvent) => {
      clearTimeout(press.current?.timer)
      const { clientX: x, clientY: y } = e
      press.current = { x, y, timer: setTimeout(() => start(id, x, y), LONG_MS) }
    },
    onPointerMove: (e: React.PointerEvent) => {
      const p = press.current
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP) clearTimeout(p.timer)
    },
    onPointerUp: () => clearTimeout(press.current?.timer),
    onPointerCancel: () => clearTimeout(press.current?.timer),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    style:
      drag?.id === id
        ? { position: 'relative' as const, zIndex: 20, boxShadow: '0 10px 28px rgba(0,0,0,0.3)', borderRadius: 12 }
        : undefined,
  })

  const boxRef = (key: Z) => (el: HTMLElement | null) => {
    if (el) boxes.current.set(key, el)
    else boxes.current.delete(key)
  }

  return { drag, shown, handleFor, rowProps, boxRef }
}

/** 1 列の並びの順番を、つまんで変える */
export function DragList<K extends string>(props: { items: K[]; render: (key: K, handle: HandleProps, dragging: boolean) => ReactNode; onChange: (items: K[]) => void }) {
  const zones: ZoneDef<'list'>[] = [{ key: 'list', title: '', items: props.items }]
  const d = useDragSort(zones, (id, _zone, index) => {
    const rest = props.items.filter((k) => k !== id)
    rest.splice(index, 0, id as K)
    if (rest.join() !== props.items.join()) props.onChange(rest)
  })
  const items = d.shown()[0].items as K[]
  return (
    <div ref={d.boxRef('list')} className="flex flex-col gap-1.5">
      {items.map((k) => (
        <div key={k} {...d.rowProps(k)}>
          {props.render(k, d.handleFor(k), d.drag?.id === k)}
        </div>
      ))}
    </div>
  )
}

/** いくつかの箱のあいだで、つまんで動かす(置いた箱の、置いた位置に入れる。同じ箱の中での並べ替えもできる) */
export function DragZones<Z extends string>(props: {
  zones: ZoneDef<Z>[]
  render: (id: string, handle: HandleProps, dragging: boolean) => ReactNode
  /** index は、動かした先の箱の中で何番目に入れるか(動かしたもの自身を除いて数える) */
  onMove: (id: string, zone: Z, index: number) => void
}) {
  const d = useDragSort(props.zones, (id, zone, index) => {
    // 元の箱の元の位置に戻しただけなら、何もしない
    const from = props.zones.find((z) => z.items.includes(id))
    if (from?.key === zone && from.items.indexOf(id) === index) return
    props.onMove(id, zone, index)
  })
  return (
    <div className="flex flex-col gap-4">
      {d.shown().map((z) => (
        <div key={z.key}>
          <p className="mb-1.5 text-xs font-bold text-c-text-muted">
            {z.title}
            {z.note && <span className="ml-2 font-normal">{z.note}</span>}
          </p>
          <div
            ref={d.boxRef(z.key)}
            className={`min-h-[56px] flex flex-col gap-1.5 p-2 rounded-xl border-2 border-dashed transition-colors ${
              d.drag?.zone === z.key ? 'border-c-accent bg-[var(--c-accent-wash)]' : 'border-c-border'
            }`}
          >
            {z.items.length === 0 && <p className="py-2 text-center text-xs text-c-text-muted">ここに動かすと、{z.title}に置きます</p>}
            {z.items.map((id) => (
              <div key={id} {...d.rowProps(id)}>
                {props.render(id, d.handleFor(id), d.drag?.id === id)}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

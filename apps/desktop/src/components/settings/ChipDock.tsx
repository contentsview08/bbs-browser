// 「箱に部品を掴んで入れる」設定の部品(ボタンの配置・レスとスレの操作バー・スレ一覧のタブで共通。スマホ版の ui/ChipDock.kt と同じ考え方)。
// 上に箱(1 つ以上)、下に「使えるもの」。部品をつかんで動かし、箱に落とすと入る(箱の中で動かす・別の箱へ・箱の外へ出すと外す)。
// 押すとメニュー(左へ・右へ・別の箱へ・外す / 箱に入れる)でも動かせる(キーボードやドラッグの苦手な人にも)。
// 部品の左に ⋮⋮ の印を付けて、つかめることが見て分かるようにする

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { isMobile } from '../../utils/platform'
import { FloatingMenu, menuPosAt, type MenuItem, type MenuPos } from '../PostMenu'

export interface DockItem {
  id: string
  name: string
  icon?: string
}

export interface DockSpec {
  key: string
  label: string
  items: DockItem[]
  /** 箱の左に固定で出るもの(スレタイ・板名など)。あれば部品は右に寄る */
  leading?: string
  /** 箱の右に固定で出るもの */
  trailing?: string
  /** これより少なくは外せない */
  minItems?: number
}

interface Drag {
  item: DockItem
  from?: { dock: string; index: number }
  x: number
  y: number
}

/** つかんだと見なす動きの大きさ(px)。これより小さく離したら「押した」(メニュー) */
const DRAG_SLOP = 5
/** スマホ(Web のスマホ表示): 長押しでつかむ(すぐつかむとページのスクロールと区別できない) */
const LONG_PRESS_MS = 350

export function ChipDock(props: {
  docks: DockSpec[]
  palette: DockItem[]
  onPlace: (dock: string, id: string, index: number) => void
  onMove: (dock: string, from: number, to: number) => void
  onRemove: (dock: string, index: number) => void
  paletteTitle?: string
  /** 何もないときの「使えるもの」の文 */
  paletteEmpty?: string
}) {
  const [drag, setDrag] = useState<Drag>()
  const [menu, setMenu] = useState<{ pos: MenuPos; items: MenuItem[] }>()
  const rootRef = useRef<HTMLDivElement>(null)

  /** 指・マウスの位置の下にある箱と、そこで入る位置(左から何番目か) */
  const dropTarget = (d: Drag): { dock: DockSpec; index: number } | undefined => {
    const root = rootRef.current
    if (!root) return undefined
    for (const dock of props.docks) {
      const box = root.querySelector<HTMLElement>(`[data-dock="${dock.key}"]`)
      if (!box) continue
      const r = box.getBoundingClientRect()
      if (d.x < r.left - 12 || d.x > r.right + 12 || d.y < r.top - 12 || d.y > r.bottom + 12) continue
      let index = 0
      box.querySelectorAll<HTMLElement>('[data-dock-index]').forEach((el) => {
        const i = Number(el.dataset.dockIndex)
        if (d.from?.dock === dock.key && i === d.from.index) return
        const c = el.getBoundingClientRect()
        if (d.x > c.left + c.width / 2) index++
      })
      return { dock, index }
    }
    return undefined
  }

  const drop = (d: Drag) => {
    const t = dropTarget(d)
    const fromDock = d.from && props.docks.find((x) => x.key === d.from!.dock)
    const canRemove = (dock: DockSpec) => dock.items.length > (dock.minItems ?? 0)
    if (!t) {
      if (fromDock && canRemove(fromDock)) props.onRemove(fromDock.key, d.from!.index)
      return
    }
    if (fromDock && fromDock.key === t.dock.key) {
      if (t.index !== d.from!.index) props.onMove(t.dock.key, d.from!.index, t.index)
      return
    }
    if (fromDock) {
      if (!canRemove(fromDock)) return
      props.onRemove(fromDock.key, d.from!.index)
    }
    props.onPlace(t.dock.key, d.item.id, t.index)
  }

  /** 部品をつかむ・押す。押しただけならメニュー */
  const pointerProps = (item: DockItem, from: Drag['from']) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return
      const el = e.currentTarget as HTMLElement
      const sx = e.clientX
      const sy = e.clientY
      let dragging = false
      let cancelled = false
      const begin = (x: number, y: number) => {
        dragging = true
        setDrag({ item, from, x, y })
      }
      const timer = isMobile ? setTimeout(() => !cancelled && begin(sx, sy), LONG_PRESS_MS) : undefined
      const move = (ev: PointerEvent) => {
        if (dragging) return setDrag((d) => d && { ...d, x: ev.clientX, y: ev.clientY })
        const far = Math.hypot(ev.clientX - sx, ev.clientY - sy) > DRAG_SLOP
        // スマホは長押しの前に動いたらスクロール(つかまない)
        if (far && isMobile) cancelled = true
        else if (far) begin(ev.clientX, ev.clientY)
      }
      const up = (ev: PointerEvent) => {
        clearTimeout(timer)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', cancel)
        if (dragging) {
          drop({ item, from, x: ev.clientX, y: ev.clientY })
          setDrag(undefined)
        } else if (!cancelled) {
          setMenu({ pos: menuPosAt(ev.clientX, ev.clientY), items: menuOf(item, from) })
        }
      }
      const cancel = () => {
        clearTimeout(timer)
        cancelled = true
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', cancel)
        setDrag(undefined)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', cancel)
      el.focus?.()
    },
  })

  /** 押したときのメニュー */
  const menuOf = (item: DockItem, from: Drag['from']): MenuItem[] => {
    if (!from) {
      return props.docks.map((dock) => ({
        label: props.docks.length === 1 ? '入れる' : `${dock.label}に入れる`,
        icon: 'add_circle',
        onClick: () => props.onPlace(dock.key, item.id, dock.items.length),
      }))
    }
    const dock = props.docks.find((d) => d.key === from.dock)!
    const removable = dock.items.length > (dock.minItems ?? 0)
    return [
      ...(from.index > 0 ? [{ label: '左へ', icon: 'chevron_left', onClick: () => props.onMove(dock.key, from.index, from.index - 1) }] : []),
      ...(from.index < dock.items.length - 1 ? [{ label: '右へ', icon: 'chevron_right', onClick: () => props.onMove(dock.key, from.index, from.index + 1) }] : []),
      ...props.docks
        .filter((d) => d.key !== dock.key && removable)
        .map((d) => ({
          label: `${d.label}へ`,
          icon: 'move_down',
          onClick: () => {
            props.onRemove(dock.key, from.index)
            props.onPlace(d.key, item.id, d.items.length)
          },
        })),
      ...(removable ? [{ label: '外す', icon: 'remove_circle', iconColor: 'var(--c-heat-very-hot)', onClick: () => props.onRemove(dock.key, from.index) }] : []),
    ]
  }

  // つかんでいる間は、文字が選ばれたり、カーソルが変わったりしないように
  useEffect(() => {
    if (!drag) return
    const prev = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'grabbing'
    return () => {
      document.body.style.userSelect = prev
      document.body.style.cursor = ''
    }
  }, [!!drag])

  const target = drag ? dropTarget(drag) : undefined
  const chip = (item: DockItem, from: Drag['from'], extra?: ReactNode) => {
    const hidden = drag && from && drag.from?.dock === from.dock && drag.from.index === from.index
    return (
      <button
        key={from ? `${from.dock}:${from.index}` : item.id}
        type="button"
        data-dock-index={from?.index}
        {...pointerProps(item, from)}
        // キーボードでは Enter でメニュー
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          setMenu({ pos: menuPosAt(r.left, r.bottom), items: menuOf(item, from) })
        }}
        title={from ? 'つかんで動かす・押すとメニュー' : 'つかんで上の箱へ・押すとメニュー'}
        className={`flex-shrink-0 flex items-center gap-1 pl-0.5 pr-2.5 h-9 rounded-lg border bg-c-surface text-sm text-c-text-body select-none ${
          from ? 'border-c-border' : 'border-dashed border-c-border'
        } hover:border-c-accent cursor-grab ${hidden ? 'opacity-25' : ''}`}
        style={{ touchAction: isMobile ? 'pan-y' : 'none' }}
      >
        <span className="material-symbols-outlined text-[18px] text-c-text-muted/70" aria-hidden>
          drag_indicator
        </span>
        {item.icon && <span className="material-symbols-outlined text-[20px] text-c-text-muted">{item.icon}</span>}
        <span className="whitespace-nowrap">{item.name}</span>
        {extra}
      </button>
    )
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-2">
      {props.docks.map((dock) => {
        const over = target?.dock.key === dock.key
        return (
          <div key={dock.key}>
            <p className="text-xs text-c-text-muted mb-1">{dock.label}</p>
            <div
              data-dock={dock.key}
              className={`flex flex-wrap items-center gap-1.5 min-h-[3rem] px-2 py-1.5 rounded-lg bg-c-bar border transition-colors ${
                over ? 'border-c-accent border-2' : 'border-c-border'
              }`}
            >
              {dock.leading && <span className="text-xs text-c-text-muted px-1 mr-auto">{dock.leading}</span>}
              {dock.items.length === 0 && <span className="text-xs text-c-text-muted px-1">ここに入れる</span>}
              {dock.items.map((item, i) => (
                <span key={`${dock.key}:${i}`} className="flex items-center">
                  {over && target?.index === i && <span className="w-0.5 h-7 bg-c-accent rounded mr-1" />}
                  {chip(item, { dock: dock.key, index: i })}
                </span>
              ))}
              {over && target && target.index >= dock.items.length - (drag?.from?.dock === dock.key ? 1 : 0) && <span className="w-0.5 h-7 bg-c-accent rounded" />}
              {dock.trailing && <span className="text-xs text-c-text-muted px-1 ml-auto">{dock.trailing}</span>}
            </div>
          </div>
        )
      })}
      <p className="flex items-center gap-1 text-xs text-c-text-muted mt-2">
        <span className="material-symbols-outlined text-[16px]">drag_indicator</span>
        {props.paletteTitle ?? '使えるもの'} ── {isMobile ? '長押しして' : ''}つかみ、上の箱へ動かします(押すとメニューでも入れられます)
      </p>
      <div className="flex flex-wrap gap-1.5">
        {props.palette.length === 0 && <span className="text-xs text-c-text-muted">{props.paletteEmpty ?? 'すべて入っています'}</span>}
        {props.palette.map((item) => chip(item, undefined))}
      </div>
      {/* つかんでいる部品は、指・マウスに付いて動く */}
      {drag && (
        <div className="fixed z-[100] pointer-events-none -translate-x-1/2 -translate-y-1/2" style={{ left: drag.x, top: drag.y }}>
          <div className="flex items-center gap-1 pl-0.5 pr-2.5 h-9 rounded-lg border border-c-accent bg-c-surface text-sm text-c-text-strong shadow-lg opacity-95">
            <span className="material-symbols-outlined text-[18px] text-c-text-muted">drag_indicator</span>
            {drag.item.icon && <span className="material-symbols-outlined text-[20px] text-c-text-muted">{drag.item.icon}</span>}
            <span className="whitespace-nowrap">{drag.item.name}</span>
          </div>
        </div>
      )}
      {menu && <FloatingMenu pos={menu.pos} items={menu.items} onClose={() => setMenu(undefined)} />}
    </div>
  )
}

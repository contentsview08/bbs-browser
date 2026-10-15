// スレのタブ。× か中クリックで閉じ、右クリックでまとめて閉じるメニューを出す。
// 幅は Chrome と同じ考え方: すべて同じ幅にし、× で閉じたあとはマウスがタブ列にある間だけ幅を固定する
// (右のタブが 1 つぶん詰まって、次のタブの × がマウスの下に来るので、× を続けて押せる)。

import { useEffect, useRef, useState } from 'react'

export interface TabItem {
  id: string
  title: string
  /** 未読のレス数 */
  unread: number
  loading: boolean
  archived: boolean
}

interface Props {
  tabs: TabItem[]
  activeId?: string
  onSelect: (id: string) => void
  onClose: (ids: string[]) => void
  onRefreshAll: () => void
  refreshingAll: boolean
  onDeleteLogs: (ids: string[]) => void
}

const MAX_WIDTH = 220
const MIN_WIDTH = 72

export default function TabBar(props: Props) {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number }>()
  const menuRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const [stripWidth, setStripWidth] = useState(0)
  /** × で閉じている間の固定幅。マウスがタブ列から出たら undefined に戻して整え直す */
  const [frozenWidth, setFrozenWidth] = useState<number>()
  const hasTabs = props.tabs.length > 0

  useEffect(() => {
    const el = stripRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setStripWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasTabs])

  const fitWidth =
    stripWidth > 0 ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(stripWidth / props.tabs.length))) : MAX_WIDTH
  const tabWidth = frozenWidth ?? fitWidth

  /** マウスで閉じるときは、いまの幅のまま固定する */
  const closeByPointer = (id: string) => {
    setFrozenWidth(tabWidth)
    props.onClose([id])
  }

  // 選んだタブが見えるように横にスクロールする
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [props.activeId])

  useEffect(() => {
    if (!menu) return
    const close = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(undefined)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menu])

  if (props.tabs.length === 0) return null

  const ids = props.tabs.map((t) => t.id)
  const menuItems = menu
    ? [
        { label: '閉じる', ids: [menu.id] },
        { label: '他のタブを閉じる', ids: ids.filter((id) => id !== menu.id) },
        { label: '右側のタブを閉じる', ids: ids.slice(ids.indexOf(menu.id) + 1) },
        { label: 'すべて閉じる', ids },
        { label: 'ログを削除して閉じる (Delete)', ids: [menu.id], deleteLog: true },
      ]
    : []

  return (
    <div className="flex-shrink-0 flex items-stretch bg-c-surface border-b border-c-border">
      <div
        ref={stripRef}
        className="flex-1 min-w-0 flex overflow-x-auto no-scrollbar"
        onMouseLeave={() => setFrozenWidth(undefined)}
      >
        {props.tabs.map((t) => {
          const active = t.id === props.activeId
          return (
            <div
              key={t.id}
              ref={active ? activeRef : undefined}
              onClick={() => props.onSelect(t.id)}
              onAuxClick={(e) => {
                if (e.button === 1) closeByPointer(t.id)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ id: t.id, x: e.clientX, y: e.clientY })
              }}
              title={t.title}
              style={{ width: tabWidth }}
              className={`group relative flex-shrink-0 flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 border-r border-c-border cursor-pointer select-none text-xs transition-colors ${
                active
                  ? 'bg-[var(--c-thread-view-bg)] text-c-text-strong'
                  : 'text-c-text-muted hover:bg-c-surface2 hover:text-c-text-body'
              } ${t.archived ? 'opacity-60' : ''}`}
            >
              {active && <span className="absolute top-0 left-0 right-0 h-[2px] bg-c-accent" />}
              {t.loading && <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>}
              <span className="flex-1 min-w-0 truncate">{t.title || '(読み込み中)'}</span>
              {t.unread > 0 && (
                <span
                  className="flex-shrink-0 font-bold text-[9px] px-1 rounded"
                  style={{ background: 'var(--c-accent-self)', color: 'var(--c-accent-self-text)' }}
                >
                  +{t.unread}
                </span>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  closeByPointer(t.id)
                }}
                className={`flex-shrink-0 p-0.5 rounded hover:bg-c-surface3 ${active ? '' : 'opacity-0 group-hover:opacity-100'}`}
                title="閉じる (Ctrl+W)"
              >
                <span className="material-symbols-outlined text-sm leading-none">close</span>
              </button>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        onClick={props.onRefreshAll}
        disabled={props.refreshingAll}
        className="flex-shrink-0 px-2.5 text-c-text-muted hover:text-c-text-strong border-l border-c-border"
        title="すべてのタブを更新"
      >
        <span className={`material-symbols-outlined text-lg ${props.refreshingAll ? 'animate-spin' : ''}`}>sync</span>
      </button>

      {menu && (
        <div
          ref={menuRef}
          className="fixed z-[9600] w-48 bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl py-1 text-sm"
          style={{ left: menu.x, top: menu.y }}
        >
          {menuItems.map((m) => (
            <button
              key={m.label}
              type="button"
              disabled={m.ids.length === 0}
              onClick={() => {
                if ('deleteLog' in m) props.onDeleteLogs(m.ids)
                else props.onClose(m.ids)
                setMenu(undefined)
              }}
              className="w-full text-left px-3 py-1.5 text-c-text-body hover:bg-c-surface2 disabled:opacity-40"
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

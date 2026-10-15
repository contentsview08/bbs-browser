// スレのタブ。× か中クリックで閉じ、右クリックでまとめて閉じるメニューを出す。

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
}

export default function TabBar(props: Props) {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number }>()
  const menuRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)

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
      ]
    : []

  return (
    <div className="flex-shrink-0 flex items-stretch bg-c-surface border-b border-c-border">
      <div className="flex-1 min-w-0 flex overflow-x-auto no-scrollbar">
        {props.tabs.map((t) => {
          const active = t.id === props.activeId
          return (
            <div
              key={t.id}
              ref={active ? activeRef : undefined}
              onClick={() => props.onSelect(t.id)}
              onAuxClick={(e) => {
                if (e.button === 1) props.onClose([t.id])
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ id: t.id, x: e.clientX, y: e.clientY })
              }}
              title={t.title}
              className={`group relative flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 min-w-[120px] max-w-[220px] border-r border-c-border cursor-pointer select-none text-xs transition-colors ${
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
                  props.onClose([t.id])
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
                props.onClose(m.ids)
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

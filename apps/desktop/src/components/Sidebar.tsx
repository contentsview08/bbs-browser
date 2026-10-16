// 左端のサイドバー: お気に入り板(開閉できる)、下に閲覧履歴と設定。
// 見た目は web 版の MenuBar.tsx に合わせている。
// しまったときも開いたときも、アイコンは左の 64px の列の同じ位置に置き、名前はその右に足すだけにする。
// 外枠の幅だけを動かして開閉するので、アイコンはそのままで、名前が右から現れるように見える。

import { useState, type ReactNode } from 'react'
import type { Board } from '@bbs-browser/connectors'
import BoardIcon from './BoardIcon'
import type { BoardMeta } from '../ui/settings'

interface Props {
  favorites: Board[]
  activeBoardUrl?: string
  onOpenBoard: (b: Board) => void
  onToggleFavorite: (b: Board) => void
  historyActive: boolean
  onOpenHistory: () => void
  onOpenSettings: () => void
  /** 設定画面の板一覧を開く(板を足したいとき) */
  onManageBoards: () => void
  collapsed: boolean
  onToggleCollapsed: () => void
  /** 板ごとの別名・ファビコン */
  boardMeta: Record<string, BoardMeta>
}

const COLLAPSED = 64
const EXPANDED = 256

/** アイコン(左の列)と名前(右)の 1 行 */
function Row(props: {
  icon: string
  label: string
  active?: boolean
  filled?: boolean
  onClick: () => void
  trailing?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={props.label}
      className={`w-full h-12 flex items-center transition-colors hover:bg-c-surface2 ${
        props.active ? 'text-c-accent' : 'text-c-text-strong'
      }`}
    >
      <span className="w-16 flex-shrink-0 flex items-center justify-center">
        <span className={`material-symbols-outlined text-2xl ${props.filled ? 'fill' : ''}`}>{props.icon}</span>
      </span>
      <span className="flex-1 min-w-0 text-left text-lg font-medium truncate">{props.label}</span>
      {props.trailing}
    </button>
  )
}

export default function Sidebar(props: Props) {
  const [favoritesOpen, setFavoritesOpen] = useState(true)
  const { collapsed } = props
  // しまっているときは、お気に入り板の中身を出さない(帯の幅には収まらないので)
  const showFavorites = favoritesOpen && !collapsed

  return (
    <aside
      className="relative flex-shrink-0 overflow-hidden bg-panel-sidebar transition-[width] duration-200 ease-out"
      style={{ width: collapsed ? COLLAPSED : EXPANDED }}
    >
      <span className="absolute right-0 top-0 bottom-0 w-px bg-c-border pointer-events-none" />
      <div className="h-full flex flex-col" style={{ width: EXPANDED }}>
        {/* 一番上の行。アドレスバーと同じ高さで、つかむとウィンドウを動かせる。境界線は引かない */}
        <div data-tauri-drag-region className="h-10 flex-shrink-0 flex items-center select-none">
          <span data-tauri-drag-region className="w-16 flex-shrink-0 flex items-center justify-center">
            <button
              type="button"
              onClick={props.onToggleCollapsed}
              className="p-1.5 text-c-text-muted hover:text-c-text-strong rounded-lg"
              title={collapsed ? 'サイドバーを広げる' : 'サイドバーをしまう'}
            >
              <span className="material-symbols-outlined text-xl">{collapsed ? 'left_panel_open' : 'left_panel_close'}</span>
            </button>
          </span>
          <span data-tauri-drag-region className="text-base font-bold text-c-text-strong">
            bbs-browser
          </span>
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar">
          <Row
            icon="star"
            label="お気に入り板"
            filled={favoritesOpen}
            onClick={() => {
              if (collapsed) {
                setFavoritesOpen(true)
                props.onToggleCollapsed()
              } else setFavoritesOpen((v) => !v)
            }}
            trailing={
              <span
                className="material-symbols-outlined text-base mr-3 transition-transform text-c-text-muted"
                style={{ transform: favoritesOpen ? 'rotate(180deg)' : undefined }}
              >
                expand_more
              </span>
            }
          />
          {showFavorites && (
            <div className="menu-reveal pb-1">
              {props.favorites.map((b) => {
                const active = b.url === props.activeBoardUrl && !props.historyActive
                return (
                  <div
                    key={b.url}
                    className={`group flex items-center pl-10 pr-2 transition-colors hover:bg-c-surface2 ${active ? 'active-board' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => props.onOpenBoard(b)}
                      className={`flex-1 min-w-0 flex items-center gap-2 text-left py-1.5 text-[1.0625rem] ${active ? 'text-c-text-strong' : 'text-c-text-body'}`}
                    >
                      <BoardIcon boardUrl={b.url} override={props.boardMeta[b.url]?.icon} />
                      <span className="truncate">{props.boardMeta[b.url]?.alias || b.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => props.onToggleFavorite(b)}
                      className="p-0.5 flex-shrink-0 text-c-text-muted opacity-0 group-hover:opacity-100 hover:text-c-text-strong"
                      title="お気に入りから外す"
                    >
                      <span className="material-symbols-outlined text-base leading-none">close</span>
                    </button>
                  </div>
                )
              })}
              <button
                type="button"
                onClick={props.onManageBoards}
                className="w-full flex items-center gap-1.5 pl-16 pr-2 py-1.5 text-sm text-c-text-muted hover:text-c-accent transition-colors"
              >
                <span className="material-symbols-outlined text-sm">add</span>
                板を追加
              </button>
            </div>
          )}
        </nav>

        <div className="py-1">
          <Row
            icon="schedule"
            label="閲覧履歴"
            active={props.historyActive}
            filled={props.historyActive}
            onClick={props.onOpenHistory}
          />
          <Row icon="settings" label="設定" onClick={props.onOpenSettings} />
        </div>
      </div>
    </aside>
  )
}

// 左端のサイドバー: お気に入り板(開閉できる)、下に閲覧履歴と設定。
// 見た目は web 版の MenuBar.tsx に合わせている。しまうとアイコンだけの帯になる。
// 板の登録や BBS メニュー(5ch の板一覧など)から選ぶのは、設定画面の「板とサイト」で行う。

import { useState } from 'react'
import type { Board } from '@bbs-browser/connectors'

interface Props {
  favorites: Board[]
  activeBoardUrl?: string
  onOpenBoard: (b: Board) => void
  onToggleFavorite: (b: Board) => void
  historyActive: boolean
  onOpenHistory: () => void
  onOpenSettings: () => void
  /** 設定画面の「板とサイト」を開く(板を足したいとき) */
  onManageBoards: () => void
  collapsed: boolean
  onToggleCollapsed: () => void
}

const ICON_BTN = 'p-1.5 text-c-text-muted hover:text-c-text-strong transition-colors rounded-lg flex-shrink-0'
const SECTION = 'w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-c-text-strong hover:bg-c-surface2'

/** しまったときの帯のボタン。名前はマウスを乗せたときの吹き出しにだけ出す */
function StripButton(props: { icon: string; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={props.label}
      className={`w-12 h-12 flex items-center justify-center rounded-[var(--btn-radius)] transition-colors hover:bg-c-surface2 ${
        props.active ? 'text-c-accent' : 'text-c-text-muted hover:text-c-text-strong'
      }`}
    >
      <span className={`material-symbols-outlined text-2xl ${props.active ? 'fill' : ''}`}>{props.icon}</span>
    </button>
  )
}

/** しまったときの帯。履歴と設定はそのまま開き、お気に入りは広げて見せる */
function Strip(props: Props & { onOpenFavorites: () => void }) {
  return (
    <aside className="w-16 flex-shrink-0 flex flex-col items-center gap-1 pb-2 bg-c-surface border-r border-c-border">
      <div data-tauri-drag-region className="h-10 w-full flex-shrink-0 flex items-center justify-center border-b border-c-border">
        <button
          type="button"
          onClick={props.onToggleCollapsed}
          className="p-1.5 text-c-text-muted hover:text-c-text-strong rounded-lg"
          title="サイドバーを広げる"
        >
          <span className="material-symbols-outlined text-xl">left_panel_open</span>
        </button>
      </div>
      <StripButton icon="star" label="お気に入り板" onClick={props.onOpenFavorites} />
      <div className="flex-1" />
      <StripButton icon="schedule" label="閲覧履歴" active={props.historyActive} onClick={props.onOpenHistory} />
      <StripButton icon="settings" label="設定" onClick={props.onOpenSettings} />
    </aside>
  )
}

export default function Sidebar(props: Props) {
  const [favoritesOpen, setFavoritesOpen] = useState(true)

  if (props.collapsed) {
    return (
      <Strip
        {...props}
        onOpenFavorites={() => {
          setFavoritesOpen(true)
          props.onToggleCollapsed()
        }}
      />
    )
  }

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col bg-c-surface border-r border-c-border">
      <div data-tauri-drag-region className="h-10 flex-shrink-0 flex items-center justify-between pl-4 pr-2 border-b border-c-border select-none">
        <span data-tauri-drag-region className="text-sm font-bold text-c-text-strong">
          bbs-browser
        </span>
        <button type="button" onClick={props.onToggleCollapsed} className={ICON_BTN} title="サイドバーをしまう">
          <span className="material-symbols-outlined text-xl">left_panel_close</span>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto custom-scrollbar py-1">
        <button type="button" onClick={() => setFavoritesOpen((v) => !v)} className={SECTION}>
          <span className={`material-symbols-outlined text-xl flex-shrink-0 ${favoritesOpen ? 'fill' : ''}`}>star</span>
          <span className="text-base font-medium flex-1 text-left">お気に入り板</span>
          <span
            className="material-symbols-outlined text-base transition-transform flex-shrink-0"
            style={{ transform: favoritesOpen ? 'rotate(180deg)' : undefined }}
          >
            expand_more
          </span>
        </button>
        {favoritesOpen && (
          <div className="menu-reveal pb-1">
            {props.favorites.map((b) => {
              const active = b.url === props.activeBoardUrl && !props.historyActive
              return (
                <div
                  key={b.url}
                  className={`group flex items-center pl-11 pr-2 transition-colors hover:bg-c-surface2 ${active ? 'active-board' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => props.onOpenBoard(b)}
                    className={`flex-1 min-w-0 text-left py-1.5 text-sm truncate ${active ? 'text-c-text-strong' : 'text-c-text-body'}`}
                  >
                    {b.name}
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
              className="w-full flex items-center gap-1.5 pl-11 pr-2 py-1.5 text-xs text-c-text-muted hover:text-c-accent transition-colors"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              板を追加
            </button>
          </div>
        )}
      </nav>

      <div className="border-t border-c-border p-2 space-y-1">
        <button
          type="button"
          onClick={props.onOpenHistory}
          className={`w-full flex items-center px-3 py-2 transition-colors rounded-[var(--btn-radius)] hover:bg-c-surface2 ${
            props.historyActive ? 'text-c-accent' : 'text-c-text-muted hover:text-c-text-strong'
          }`}
        >
          <span className={`material-symbols-outlined text-xl flex-shrink-0 ${props.historyActive ? 'fill' : ''}`}>schedule</span>
          <span className="ml-3 text-sm">閲覧履歴</span>
        </button>
        <button
          type="button"
          onClick={props.onOpenSettings}
          className="w-full flex items-center px-3 py-2 text-c-text-muted hover:text-c-text-strong hover:bg-c-surface2 transition-colors rounded-[var(--btn-radius)]"
        >
          <span className="material-symbols-outlined text-xl flex-shrink-0">settings</span>
          <span className="ml-3 text-sm">設定</span>
        </button>
      </div>
    </aside>
  )
}

// 左端のサイドバー: URL を開く・お気に入り板・閲覧履歴・サイトの板一覧(カテゴリ別)・設定。
// 見た目は web 版の MenuBar.tsx(展開時)に合わせている。

import { useMemo, useState } from 'react'
import type { Board, SiteConfig } from '@bbs-browser/connectors'

interface Props {
  sites: SiteConfig[]
  site?: SiteConfig
  onSelectSite: (s: SiteConfig) => void
  boards: Board[]
  favorites: Board[]
  activeBoardUrl?: string
  onOpenBoard: (b: Board) => void
  onToggleFavorite: (b: Board) => void
  onRefreshBoards: () => void
  onOpenUrl: (url: string) => void
  historyActive: boolean
  onOpenHistory: () => void
  onOpenSettings: () => void
  loading: boolean
}

const ICON_BTN = 'p-1.5 text-c-text-muted hover:text-c-text-strong transition-colors rounded-lg flex-shrink-0'
const INPUT =
  'w-full bg-c-surface2 border-c-border rounded-[var(--btn-radius)] text-sm text-c-text-body placeholder-c-text-muted py-1.5 focus:ring-c-accent focus:border-c-accent'
const SECTION = 'w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-c-text-strong hover:bg-c-surface2'

function BoardRow(props: { board: Board; active: boolean; favorite: boolean; onOpen: () => void; onToggleFavorite: () => void }) {
  return (
    <div
      className={`group flex items-center pl-6 pr-2 transition-colors hover:bg-c-surface2 ${props.active ? 'active-board' : ''}`}
    >
      <button
        type="button"
        onClick={props.onOpen}
        className={`flex-1 min-w-0 text-left py-1.5 text-sm truncate ${props.active ? 'text-c-text-strong' : 'text-c-text-body'}`}
      >
        {props.board.name}
      </button>
      <button
        type="button"
        onClick={props.onToggleFavorite}
        className={`p-0.5 flex-shrink-0 transition-opacity ${props.favorite ? 'text-c-heat-warm' : 'text-c-text-muted opacity-0 group-hover:opacity-100'}`}
        title={props.favorite ? 'お気に入りから外す' : 'お気に入りに追加'}
      >
        <span className={`material-symbols-outlined text-base leading-none ${props.favorite ? 'fill' : ''}`}>star</span>
      </button>
    </div>
  )
}

export default function Sidebar(props: Props) {
  const [filter, setFilter] = useState('')
  const [url, setUrl] = useState('')
  const [openCats, setOpenCats] = useState<Set<string>>(new Set())
  const favoriteUrls = useMemo(() => new Set(props.favorites.map((b) => b.url)), [props.favorites])

  const grouped = useMemo(() => {
    const q = filter.trim()
    const map = new Map<string, Board[]>()
    for (const b of props.boards) {
      if (q && !b.name.includes(q)) continue
      const cat = b.category ?? '(未分類)'
      map.set(cat, [...(map.get(cat) ?? []), b])
    }
    return [...map]
  }, [props.boards, filter])

  const toggle = (cat: string) =>
    setOpenCats((s) => {
      const next = new Set(s)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })

  const row = (b: Board) => (
    <BoardRow
      key={b.url}
      board={b}
      active={b.url === props.activeBoardUrl && !props.historyActive}
      favorite={favoriteUrls.has(b.url)}
      onOpen={() => props.onOpenBoard(b)}
      onToggleFavorite={() => props.onToggleFavorite(b)}
    />
  )

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col bg-c-surface border-r border-c-border">
      <div className="p-3 border-b border-c-border">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (url.trim()) props.onOpenUrl(url.trim())
            setUrl('')
          }}
        >
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="板・スレの URL を開く"
            className={INPUT}
          />
        </form>
      </div>

      <nav className="flex-1 overflow-y-auto custom-scrollbar py-1">
        <button
          type="button"
          onClick={props.onOpenHistory}
          className={`${SECTION} ${props.historyActive ? 'active-board' : ''}`}
        >
          <span className={`material-symbols-outlined text-xl flex-shrink-0 ${props.historyActive ? 'fill' : ''}`}>schedule</span>
          <span className="text-base font-medium flex-1 text-left">閲覧履歴</span>
        </button>

        <div className={SECTION + ' cursor-default hover:bg-transparent'}>
          <span className="material-symbols-outlined text-xl flex-shrink-0">star</span>
          <span className="text-base font-medium flex-1 text-left">お気に入り</span>
        </div>
        {props.favorites.length === 0 ? (
          <div className="px-6 py-1.5 text-xs text-c-text-muted">板の ★ で追加できます</div>
        ) : (
          props.favorites.map(row)
        )}

        <div className="my-2 border-t border-c-border" />

        <div className="px-3 pb-2 space-y-2">
          <div className="flex items-center gap-1">
            <select
              value={props.site?.menuUrl ?? ''}
              onChange={(e) => {
                const s = props.sites.find((x) => x.menuUrl === e.target.value)
                if (s) props.onSelectSite(s)
              }}
              className="flex-1 min-w-0 bg-c-surface2 border-c-border rounded-[var(--btn-radius)] text-sm text-c-text-strong py-1.5 focus:ring-c-accent focus:border-c-accent"
            >
              {props.sites.map((s) => (
                <option key={s.menuUrl} value={s.menuUrl}>
                  {s.name}
                </option>
              ))}
            </select>
            <button type="button" onClick={props.onRefreshBoards} className={ICON_BTN} title="板一覧を更新">
              <span className={`material-symbols-outlined text-lg ${props.loading ? 'animate-spin' : ''}`}>refresh</span>
            </button>
          </div>
          <input type="text" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="板を絞り込む" className={INPUT} />
        </div>

        {grouped.map(([cat, list]) => {
          const open = filter.trim() !== '' || openCats.has(cat)
          return (
            <div key={cat}>
              <button
                type="button"
                onClick={() => toggle(cat)}
                className="w-full flex items-center gap-2 px-4 py-1.5 text-sm font-bold text-c-text-muted hover:text-c-text-body transition-colors"
              >
                <span className="flex-1 text-left truncate">{cat}</span>
                <span
                  className="material-symbols-outlined text-base transition-transform flex-shrink-0"
                  style={{ transform: open ? 'rotate(180deg)' : undefined }}
                >
                  expand_more
                </span>
              </button>
              {open && list.map(row)}
            </div>
          )
        })}
        {grouped.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-c-text-muted">
            {props.loading ? '読み込み中...' : '板がありません'}
          </div>
        )}
      </nav>

      <div className="border-t border-c-border p-2">
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

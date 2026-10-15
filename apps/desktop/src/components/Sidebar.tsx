// 左端のサイドバー: サイトの切り替え・板一覧(カテゴリ別)・閲覧履歴。
// 見た目は web 版の MenuBar.tsx(展開時)に合わせている。

import { useMemo, useState } from 'react'
import type { Board, SiteConfig } from '@bbs-browser/connectors'

interface Props {
  sites: SiteConfig[]
  site?: SiteConfig
  onSelectSite: (s: SiteConfig) => void
  onAddSite: () => void
  boards: Board[]
  activeBoardUrl?: string
  onOpenBoard: (b: Board) => void
  onRefreshBoards: () => void
  historyActive: boolean
  onOpenHistory: () => void
  loading: boolean
}

const ICON_BTN = 'p-1.5 text-c-text-muted hover:text-c-text-strong transition-colors rounded-lg flex-shrink-0'

export default function Sidebar(props: Props) {
  const [filter, setFilter] = useState('')
  const [openCats, setOpenCats] = useState<Set<string>>(new Set())

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

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col bg-c-surface border-r border-c-border">
      <div className="p-3 space-y-2 border-b border-c-border">
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
          <button type="button" onClick={props.onAddSite} className={ICON_BTN} title="サイトを追加(bbsmenu の URL)">
            <span className="material-symbols-outlined text-lg">add</span>
          </button>
          <button type="button" onClick={props.onRefreshBoards} className={ICON_BTN} title="板一覧を更新">
            <span className={`material-symbols-outlined text-lg ${props.loading ? 'animate-spin' : ''}`}>refresh</span>
          </button>
        </div>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="板を絞り込む"
          className="w-full bg-c-surface2 border-c-border rounded-[var(--btn-radius)] text-sm text-c-text-body placeholder-c-text-muted py-1.5 focus:ring-c-accent focus:border-c-accent"
        />
      </div>

      <nav className="flex-1 overflow-y-auto custom-scrollbar py-1">
        <button
          type="button"
          onClick={props.onOpenHistory}
          className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-c-text-strong hover:bg-c-surface2 ${props.historyActive ? 'active-board' : ''}`}
        >
          <span className={`material-symbols-outlined text-xl flex-shrink-0 ${props.historyActive ? 'fill' : ''}`}>schedule</span>
          <span className="text-base font-medium flex-1 text-left">閲覧履歴</span>
        </button>

        <div className="my-1 border-t border-c-border" />

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
              {open &&
                list.map((b) => (
                  <button
                    key={b.url}
                    type="button"
                    onClick={() => props.onOpenBoard(b)}
                    className={`w-full text-left px-6 py-1.5 text-sm truncate transition-colors hover:bg-c-surface2 ${
                      b.url === props.activeBoardUrl && !props.historyActive ? 'active-board text-c-text-strong' : 'text-c-text-body'
                    }`}
                  >
                    {b.name}
                  </button>
                ))}
            </div>
          )
        })}
        {grouped.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-c-text-muted">
            {props.loading ? '読み込み中...' : '板がありません'}
          </div>
        )}
      </nav>
    </aside>
  )
}

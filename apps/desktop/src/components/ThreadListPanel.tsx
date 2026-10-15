// スレ一覧パネル。web 版の ThreadListPanel.tsx(PC 版)の見た目を移植。
// 板のスレ一覧と閲覧履歴の両方をこのパネルで出す。

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ThreadSummary } from '@bbs-browser/connectors'
import type { ThreadState } from '@bbs-browser/logstore'
import ThreadCard from './ThreadCard'
import { momentum, rankMomentum } from '../utils/thread'

type SortMode = 'momentum' | 'newest'
type SortState = { mode: SortMode; dir: 'desc' | 'asc' } | null

/** 同じタブを押すたびに 降順 → 昇順 → 解除(subject.txt の並び) と巡る */
function cycleSort(s: SortState, mode: SortMode): SortState {
  if (s?.mode !== mode) return { mode, dir: 'desc' }
  return s.dir === 'desc' ? { mode, dir: 'asc' } : null
}

export const threadId = (t: ThreadSummary) => `${t.boardUrl}${t.key}`

interface Props {
  title: string
  threads: ThreadSummary[]
  stateOf: (t: ThreadSummary) => ThreadState | undefined
  activeId?: string
  loading: boolean
  emptyText: string
  onOpen: (t: ThreadSummary) => void
  onRefresh?: () => void
  width: number
  onResize: (width: number) => void
  /** ヘッダー右端に置く追加のボタン(表示スタイルメニューなど) */
  actions?: ReactNode
}

const TAB = 'relative flex items-center justify-center gap-1 py-2.5 transition-colors whitespace-nowrap'

export default function ThreadListPanel(props: Props) {
  const { threads, stateOf } = props
  const [sort, setSort] = useState<SortState>(null)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [searchActive, setSearchActive] = useState(false)
  const [query, setQuery] = useState('')
  const [width, setWidth] = useState(props.width)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => setWidth(props.width), [props.width])
  useEffect(() => {
    if (searchActive) searchRef.current?.focus()
  }, [searchActive])

  const ranks = useMemo(() => rankMomentum(threads, threadId), [threads])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = threads.filter((t) => {
      if (q && !t.title.toLowerCase().includes(q)) return false
      if (unreadOnly) {
        const s = stateOf(t)
        return s !== undefined && s.readNo < t.postCount
      }
      return true
    })
    if (sort) {
      const sign = sort.dir === 'desc' ? -1 : 1
      const value = (t: ThreadSummary) =>
        sort.mode === 'momentum' ? momentum(t) : (t.createdAt?.getTime() ?? 0)
      list = [...list].sort((a, b) => (value(a) - value(b)) * sign)
    }
    return list
  }, [threads, stateOf, query, unreadOnly, sort])

  // 右端のハンドルをドラッグして幅を変える。離したときに保存する
  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    let latest = startWidth
    const onMove = (ev: MouseEvent) => {
      latest = Math.min(800, Math.max(280, startWidth + ev.clientX - startX))
      setWidth(latest)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      props.onResize(latest)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <section style={{ width }} className="retro-panel flex-shrink-0 flex flex-col relative">
      <div
        className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-c-accent/30 transition-colors z-20"
        onMouseDown={onResizeStart}
      />

      <div className="h-full overflow-y-auto custom-scrollbar flex flex-col">
        <div className="sticky top-0 z-10 frosted-glass flex-shrink-0">
          <div className="p-4">
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0 h-11">
                <h2
                  className={`absolute inset-0 flex items-center min-w-0 font-bold text-c-text-strong text-2xl retro-font transition-opacity duration-200 ${
                    searchActive ? 'opacity-0 pointer-events-none' : 'opacity-100'
                  }`}
                >
                  <span className="truncate">{props.title}</span>
                </h2>
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onBlur={() => {
                    if (!query.trim()) setSearchActive(false)
                  }}
                  placeholder="スレッド検索..."
                  className={`absolute inset-y-0 right-0 h-9 my-auto bg-c-surface border border-c-border rounded-[var(--card-radius)] px-3 text-sm text-c-text-body placeholder-c-text-muted focus:outline-none transition-[width,opacity] duration-300 ease-out ${
                    searchActive ? 'w-full opacity-100' : 'w-0 opacity-0 pointer-events-none'
                  }`}
                />
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setSearchActive((v) => !v)}
                  className={`p-1.5 rounded-lg transition-colors ${searchActive ? 'text-c-accent bg-c-accent/10' : 'text-c-text-muted hover:text-c-text-strong'}`}
                  title="スレッド検索"
                >
                  <span className="material-symbols-outlined text-lg">search</span>
                </button>
                {props.actions}
                {props.onRefresh && (
                  <button
                    type="button"
                    onClick={props.onRefresh}
                    disabled={props.loading}
                    className="p-1.5 text-c-text-muted hover:text-c-text-strong transition-colors rounded-lg"
                    title="スレッド一覧を更新"
                  >
                    <span className={`material-symbols-outlined text-lg ${props.loading ? 'animate-spin' : ''}`}>refresh</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 px-4 border-b border-c-border text-sm font-medium">
            <button
              type="button"
              onClick={() => setUnreadOnly((v) => !v)}
              className={`${TAB} ${unreadOnly ? 'text-c-accent' : 'text-c-text-muted hover:text-c-text-body'}`}
              title="ログがあり、新着レスのあるスレだけを出す"
            >
              <span className="material-symbols-outlined text-base leading-none">mark_email_unread</span>
              未読
              {unreadOnly && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-c-accent rounded-full" />}
            </button>
            {[
              { mode: 'momentum' as const, label: '勢い順', icon: 'local_fire_department' },
              { mode: 'newest' as const, label: '新しい順', icon: 'schedule' },
            ].map(({ mode, label, icon }) => {
              const active = sort?.mode === mode
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSort((s) => cycleSort(s, mode))}
                  className={`${TAB} ${active ? 'text-c-accent' : 'text-c-text-muted hover:text-c-text-body'}`}
                >
                  <span className="material-symbols-outlined text-base leading-none">{icon}</span>
                  {label}
                  <span className={`material-symbols-outlined text-sm leading-none ${active ? '' : 'invisible'}`}>
                    {active && sort.dir === 'desc' ? 'arrow_downward' : 'arrow_upward'}
                  </span>
                  {active && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-c-accent rounded-full" />}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex-1">
          {visible.length === 0 ? (
            <div className="p-8 text-center text-c-text-muted text-sm">
              {props.loading ? '読み込み中...' : props.emptyText}
            </div>
          ) : (
            <div
              className="flex flex-col"
              style={{ padding: 'var(--list-padding-thread)', gap: 'var(--list-gap-thread)' }}
            >
              {visible.map((t) => {
                const id = threadId(t)
                return (
                  <ThreadCard
                    key={id}
                    thread={t}
                    state={stateOf(t)}
                    isActive={props.activeId === id}
                    momentumRank={ranks.get(id) ?? 0}
                    onClick={() => props.onOpen(t)}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// スレ一覧パネル。web 版の ThreadListPanel.tsx(PC 版)の見た目を移植。
// 板のスレ一覧と閲覧履歴の両方をこのパネルで出す。

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ThreadSummary } from '@bbs-browser/connectors'
import type { ThreadState } from '@bbs-browser/logstore'
import ThreadCard from './ThreadCard'
import LoadingCenter from './LoadingCenter'
import PullSpinner from './PullSpinner'
import { useWheelPullRefresh } from '../hooks/useWheelPullRefresh'
import { PULL_HIDDEN_Y } from '../utils/pullRefresh'
import { momentum, rankMomentum } from '../utils/thread'
import type { ThreadSort } from '../ui/settings'
import { normalizeForSearch } from '../utils/postBody'
import { useEvent } from '../hooks/useEvent'

type SortMode = 'momentum' | 'newest'
type SortState = { mode: SortMode; dir: 'desc' | 'asc' } | null

/** 同じタブを押すたびに 降順 → 昇順 → 解除(subject.txt の並び) と巡る */
function cycleSort(s: SortState, mode: SortMode): SortState {
  if (s?.mode !== mode) return { mode, dir: 'desc' }
  return s.dir === 'desc' ? { mode, dir: 'asc' } : null
}

export const threadId = (t: ThreadSummary) => `${t.boardUrl}${t.key}`

/** スレ一覧に差し込む帯(キーワードの見出しなど) */
function Band(props: { icon: string; label: string; count: number; accent?: boolean }) {
  return (
    <div
      className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold ${props.accent ? 'text-c-accent' : 'text-c-text-muted'}`}
      style={{ background: props.accent ? 'var(--c-accent-wash)' : 'var(--c-surface2)' }}
    >
      <span className="material-symbols-outlined text-sm leading-none">{props.icon}</span>
      <span className="flex-1 min-w-0 truncate">{props.label}</span>
      <span className="font-normal tabular-nums">{props.count}</span>
    </div>
  )
}

interface Props {
  title: string
  threads: ThreadSummary[]
  stateOf: (t: ThreadSummary) => ThreadState | undefined
  activeId?: string
  loading: boolean
  emptyText: string
  onOpen: (t: ThreadSummary) => void
  onRefresh?: () => Promise<unknown> | void
  width: number
  onResize: (width: number) => void
  /** ヘッダー右端に置く追加のボタン(表示スタイルメニューなど) */
  actions?: ReactNode
  /** 最初の並び順(設定) */
  defaultSort: ThreadSort
  /** スレタイの NG に当たるスレは出さない */
  isNg: (t: ThreadSummary) => boolean
  /**
   * 「未読」で絞り込んだスレの顔ぶれを控え直すきっかけ。これが変わるまでは、読み終えたスレも並べ続ける。
   * 渡さなければ、スレ一覧(threads)を取り直したときに控え直す
   */
  snapshotKey?: unknown
  /** 興味のあるキーワード。スレタイに含むスレを、キーワードの帯の下にまとめて上に出す */
  keywords?: string[]
  /** スレタイを NG に追加する画面を開く */
  onNgThread?: (title: string) => void
  /** スレのログ(閲覧履歴)を消す */
  onDeleteThreadLog?: (t: ThreadSummary) => void
  /** スレのブラウザ用の URL(コピーに使う) */
  threadUrl?: (t: ThreadSummary) => string
  /** 渡されたときだけ、チェックボックスで選んでまとめてログを消せる(閲覧履歴) */
  onDeleteLogs?: (threads: ThreadSummary[]) => void
  /** スレを立てられる板のときだけ渡す */
  onNewThread?: () => void
  /** お気に入りのスレ(threadId の集まり)と、足す・外す */
  favoriteIds?: Set<string>
  onToggleFavoriteThread?: (t: ThreadSummary) => void
  /** 板を開いているときだけ ★ を出す */
  favorite?: { active: boolean; onToggle: () => void }
}

const TAB = 'relative flex items-center justify-center gap-1 py-2.5 transition-colors whitespace-nowrap'

export default function ThreadListPanel(props: Props) {
  const { threads, stateOf } = props
  const [sort, setSort] = useState<SortState>(
    props.defaultSort === 'subject' ? null : { mode: props.defaultSort, dir: 'desc' },
  )
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [searchActive, setSearchActive] = useState(false)
  const [query, setQuery] = useState('')
  const [width, setWidth] = useState(props.width)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const selectable = props.onDeleteLogs !== undefined
  const searchRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const [headerHeight, setHeaderHeight] = useState(0)
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setHeaderHeight(el.offsetHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  // 一番上でさらにホイールを回すと一覧を更新する(web 版と同じ)
  const pull = useWheelPullRefresh({ onRefresh: () => props.onRefresh?.(), sign: 1 })

  useEffect(() => setWidth(props.width), [props.width])
  useEffect(() => {
    if (searchActive) searchRef.current?.focus()
  }, [searchActive])

  // 勢いは「今の時刻」で決まるので、スレ一覧を取ったときに一度だけ計算して控える。
  // 描き直しのたびに計算し直すと、スレを更新しただけ(既読が変わっただけ)で勢いの近いスレの順番が入れ替わってしまう
  const momenta = useMemo(() => {
    const now = Date.now()
    return new Map(threads.map((t) => [threadId(t), momentum(t, now)]))
  }, [threads])
  const ranks = useMemo(() => rankMomentum(momenta), [momenta])
  /** この板の未読レスの合計(ログのあるスレの、まだ読んでいないレスの数を足したもの) */
  const unreadTotal = useMemo(
    () =>
      threads.reduce((sum, t) => {
        const st = stateOf(t)
        return st && !props.isNg(t) ? sum + Math.max(0, t.postCount - st.readNo) : sum
      }, 0),
    [threads, stateOf, props.isNg],
  )

  // 「未読」を押した時点(と、一覧を取り直した時点)の未読のスレを控える。
  // 読むたびに絞り込み直すと、読み終えたスレが急に一覧から消えてしまうので
  const [unreadSnapshot, setUnreadSnapshot] = useState<Set<string>>()
  const stateOfRef = useRef(stateOf)
  stateOfRef.current = stateOf
  const snapshotKey = props.snapshotKey ?? threads
  useEffect(() => {
    if (!unreadOnly) return setUnreadSnapshot(undefined)
    const of = stateOfRef.current
    setUnreadSnapshot(
      new Set(
        threads
          .filter((t) => {
            const s = of(t)
            return s !== undefined && s.readNo < t.postCount
          })
          .map(threadId),
      ),
    )
    // threads は snapshotKey を渡さないときのきっかけとして入っている
  }, [unreadOnly, snapshotKey])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = threads.filter((t) => {
      if (props.isNg(t)) return false
      if (q && !t.title.toLowerCase().includes(q)) return false
      if (unreadOnly) return unreadSnapshot?.has(threadId(t)) ?? false
      return true
    })
    if (sort) {
      const sign = sort.dir === 'desc' ? -1 : 1
      const value = (t: ThreadSummary) =>
        sort.mode === 'momentum' ? (momenta.get(threadId(t)) ?? 0) : (t.createdAt?.getTime() ?? 0)
      list = [...list].sort((a, b) => (value(a) - value(b)) * sign)
    }
    return list
  }, [threads, query, unreadOnly, unreadSnapshot, sort, props.isNg, momenta])

  /**
   * キーワードごとのまとまり。当たるスレのないキーワードは出さない。
   * 複数のキーワードに当たるスレは、先に登録したキーワードの方に入れる
   */
  const keywordGroups = useMemo(() => {
    const keywords = (props.keywords ?? []).map((k) => k.trim()).filter(Boolean)
    if (keywords.length === 0) return undefined
    const taken = new Set<string>()
    const groups: { keyword: string; threads: ThreadSummary[] }[] = []
    for (const keyword of keywords) {
      const k = normalizeForSearch(keyword)
      const hits = visible.filter((t) => !taken.has(threadId(t)) && normalizeForSearch(t.title).includes(k))
      hits.forEach((t) => taken.add(threadId(t)))
      if (hits.length > 0) groups.push({ keyword, threads: hits })
    }
    if (groups.length === 0) return undefined
    return { groups, rest: visible.filter((t) => !taken.has(threadId(t))) }
  }, [visible, props.keywords])

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

  // カードに渡す関数は、どのカードにも同じもの(memo で描き直さずに済むように)
  const onOpenCard = useEvent((t: ThreadSummary) => props.onOpen(t))
  const onNgCard = useEvent((t: ThreadSummary) => props.onNgThread?.(t.title))
  const onCopyCard = useEvent(
    (t: ThreadSummary) => void navigator.clipboard.writeText(props.threadUrl ? `${t.title}\n${props.threadUrl(t)}` : t.title),
  )
  const onDeleteCard = useEvent((t: ThreadSummary) => props.onDeleteThreadLog?.(t))
  const onFavoriteCard = useEvent((t: ThreadSummary) => props.onToggleFavoriteThread?.(t))

  const renderThread = (t: ThreadSummary) => {
    const id = threadId(t)
    const card = (
      <ThreadCard
        key={id}
        thread={t}
        state={stateOf(t)}
        isActive={props.activeId === id}
        momentum={momenta.get(id) ?? 0}
        momentumRank={ranks.get(id) ?? 0}
        onOpen={onOpenCard}
        onNg={props.onNgThread ? onNgCard : undefined}
        onCopy={onCopyCard}
        onDeleteLog={props.onDeleteThreadLog ? onDeleteCard : undefined}
        isFavorite={props.favoriteIds?.has(id) ?? false}
        onToggleFavorite={props.onToggleFavoriteThread ? onFavoriteCard : undefined}
      />
    )
    if (!selectable) return card
    return (
      <div key={id} className="flex items-stretch">
        <label className="flex items-center px-2 cursor-pointer" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected.has(id)}
            onChange={(e) =>
              setSelected((s) => {
                const next = new Set(s)
                if (e.target.checked) next.add(id)
                else next.delete(id)
                return next
              })
            }
            className="rounded"
          />
        </label>
        <div className="flex-1 min-w-0">{card}</div>
      </div>
    )
  }

  return (
    <section
      style={{ width }}
      className="flex-shrink-0 flex flex-col relative overflow-hidden border-r border-c-border bg-panel-list"
    >
      <div
        className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-c-accent/30 transition-colors z-20"
        onMouseDown={onResizeStart}
      />

      <div
        ref={pull.indicatorRef}
        className="absolute left-0 right-0 flex justify-center pointer-events-none z-20"
        style={{ top: headerHeight, opacity: 0, transform: `translateY(${PULL_HIDDEN_Y}px)` }}
      >
        <PullSpinner iconRef={pull.iconRef} />
      </div>
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto custom-scrollbar thick-scrollbar flex flex-col"
        onWheel={(e) => {
          if (props.onRefresh && e.deltaY < 0 && (scrollRef.current?.scrollTop ?? 1) < 1) pull.pull(-e.deltaY)
        }}
      >
        <div ref={headerRef} className="sticky top-0 z-10 frosted-glass flex-shrink-0">
          <div className="p-4">
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0 h-11">
                <h2
                  className={`absolute inset-0 flex items-center min-w-0 font-bold text-c-text-strong text-xl transition-opacity duration-200 ${
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
                {props.onNewThread && (
                  <button
                    type="button"
                    onClick={props.onNewThread}
                    className="p-1.5 text-c-text-muted hover:text-c-text-strong transition-colors rounded-lg"
                    title="スレを立てる"
                  >
                    <span className="material-symbols-outlined text-lg">edit_square</span>
                  </button>
                )}
                {props.favorite && (
                  <button
                    type="button"
                    onClick={props.favorite.onToggle}
                    className={`p-1.5 rounded-lg transition-colors ${props.favorite.active ? 'text-c-heat-warm' : 'text-c-text-muted hover:text-c-text-strong'}`}
                    title={props.favorite.active ? 'お気に入りから外す' : 'お気に入りに追加'}
                  >
                    <span className={`material-symbols-outlined text-lg ${props.favorite.active ? 'fill' : ''}`}>star</span>
                  </button>
                )}
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

          {selectable && (
            <div className="flex items-center gap-2 px-2 py-1.5 border-b border-c-border text-xs">
              {/* 一番左のチェックボックスで、すべて選ぶ・すべて外す。一部だけのときは「－」 */}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  ref={(el) => {
                    if (el) el.indeterminate = selected.size > 0 && selected.size < visible.length
                  }}
                  checked={visible.length > 0 && selected.size === visible.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(visible.map(threadId)) : new Set())}
                  className="rounded"
                />
                <span className="text-c-text-muted">{selected.size > 0 ? `${selected.size} 件選択中` : 'すべて選択'}</span>
              </label>
              {selected.size > 0 && (
                <button
                  type="button"
                  className="ml-auto flex items-center gap-0.5 font-bold text-c-heat-very-hot hover:opacity-80"
                  onClick={() => {
                    props.onDeleteLogs!(visible.filter((t) => selected.has(threadId(t))))
                    setSelected(new Set())
                  }}
                >
                  <span className="material-symbols-outlined text-sm">delete</span>
                  ログを削除
                </button>
              )}
            </div>
          )}
          <div className="grid grid-cols-3 px-4 border-b border-c-border text-sm font-medium">
            <button
              type="button"
              onClick={() => setUnreadOnly((v) => !v)}
              className={`${TAB} ${unreadOnly ? 'text-c-accent' : 'text-c-text-muted hover:text-c-text-body'}`}
              title="ログがあり、新着レスのあるスレだけを出す"
            >
              <span className="material-symbols-outlined text-base leading-none">mark_email_unread</span>
              未読
              {unreadTotal > 0 && (
                <span
                  className="font-bold text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap"
                  style={{ background: 'var(--c-accent-self)', color: 'var(--c-accent-self-text)' }}
                >
                  +{unreadTotal}
                </span>
              )}
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

        <div className="flex-1 flex flex-col">
          {visible.length === 0 ? (
            props.loading ? (
              <LoadingCenter />
            ) : (
              <div className="p-8 text-center text-c-text-muted text-sm">{props.emptyText}</div>
            )
          ) : (
            <div
              className="flex flex-col"
              style={{ padding: 'var(--list-padding-thread)', gap: 'var(--list-gap-thread)' }}
            >
              {keywordGroups ? (
                <>
                  {keywordGroups.groups.map((g) => (
                    <div key={g.keyword} className="flex flex-col" style={{ gap: 'var(--list-gap-thread)' }}>
                      <Band icon="sell" label={g.keyword} count={g.threads.length} accent />
                      {g.threads.map(renderThread)}
                    </div>
                  ))}
                  {keywordGroups.rest.length > 0 && <Band icon="list" label="その他のスレ" count={keywordGroups.rest.length} />}
                  {keywordGroups.rest.map(renderThread)}
                </>
              ) : (
                visible.map(renderThread)
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

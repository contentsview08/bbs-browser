// スレ一覧パネル。web 版の ThreadListPanel.tsx(PC 版)の見た目を移植。
// 板のスレ一覧と閲覧履歴の両方をこのパネルで出す。

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ThreadSummary } from '@bbs-browser/connectors'
import type { ThreadState } from '@bbs-browser/logstore'
import ThreadCard from './ThreadCard'
import LoadingCenter from './LoadingCenter'
import PullSpinner from './PullSpinner'
import { useWheelPullRefresh } from '../hooks/useWheelPullRefresh'
import RefreshButton from './RefreshButton'
import { ActionButtons, MoreMenu, type BarAction } from './ActionBar'
import type { Placement } from '../utils/toolbar'
import { LIST_REFRESH_COOLDOWN_MS } from '../utils/cooldown'
import { PULL_HIDDEN_Y } from '../utils/pullRefresh'
import { momentum, rankMomentum } from '../utils/thread'
import type { ThreadSort } from '../ui/settings'
import { normalizeForSearch } from '../utils/postBody'
import { createKeyReader, modalOpen, isReloadKey, type Keymap } from '../utils/keymap'
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
  /**
   * 1 画面のとき: 決まった幅ではなく広げる。幅を変えるつまみも出さない。
   * full: 画面の幅いっぱい(狭くて自動で 1 画面になったとき) / centered: 読みやすい幅までで真ん中に(設定で 1 画面にしたとき)
   */
  fill?: 'full' | 'centered'
  /** 見えていて、キー操作(Esc・J・K など)を受け取るか。1 画面でスレ表示を出しているときは false */
  active?: boolean
  /** キー操作の割り当て(スレ表示と同じ)。J・K でカードを選び、Enter で開く */
  keymap?: Keymap
  /** 表示スタイルのメニュー。帯に置くボタン(up ならメニューを上に開く)と、︙ の中に出す中身 */
  style?: { button: (up: boolean) => ReactNode; items: ReactNode }
  /** 操作ボタンの置き場所(設定) */
  placements: Record<string, Placement>
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
  /** 手で更新したあとのクールダウンが明ける時刻(更新ボタンに残りを出し、引っぱっても数えない) */
  refreshReadyAt?: number
  /** この時刻より後に立ったスレに「新」の印を付ける(前回その板の一覧を取った時刻) */
  newSince?: number
  /** 一番上でさらにホイールを回したら更新する(設定) */
  pullToRefresh: boolean
  /** 板を開いているときだけ ★ を出す */
  favorite?: { active: boolean; onToggle: () => void }
}

/** 1 画面のとき、スレ一覧を広げる幅の上限(これより広いと 1 行が長くて読みにくい) */
const FILL_MAX_WIDTH = 820
const LIST_BTN = 'p-1.5 text-c-text-muted hover:text-c-text-strong transition-colors rounded-lg'
const TAB = 'relative flex items-center justify-center gap-1 py-2.5 transition-colors whitespace-nowrap'

export default function ThreadListPanel(props: Props) {
  const { threads, stateOf } = props
  const defaultSort: SortState = props.defaultSort === 'subject' ? null : { mode: props.defaultSort, dir: 'desc' }
  const [sort, setSort] = useState<SortState>(defaultSort)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [searchActive, setSearchActive] = useState(false)
  const [query, setQuery] = useState('')

  // Esc：未読だけ・並べ替え・検索を外して、いつもの並びに戻す。
  // 入力欄の中の Esc と、スレ表示が先に使った Esc(ポップアップを閉じた・絞り込みを解いた)には手を出さない。
  // スレ表示の受け取りと順番が決まらないので、ほかの受け取りが済んでから(マイクロタスクで)見る
  const resetView = useEvent(() => {
    const sorted = JSON.stringify(sort) !== JSON.stringify(defaultSort)
    if (!unreadOnly && !sorted && !query && !searchActive) return
    setUnreadOnly(false)
    setSort(defaultSort)
    setQuery('')
    setSearchActive(false)
  })
  useEffect(() => {
    if (props.active === false) return
    const onKey = (e: KeyboardEvent) => {
      if (modalOpen()) return // ダイアログが開いている間は、後ろの画面を動かさない
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      queueMicrotask(() => {
        if (!e.defaultPrevented) resetView()
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.active, resetView])

  // キー操作。キーを受け取っているとき(2 画面なら上に線が出ているとき)だけ。割り当てはスレ表示と同じで、
  // 次/前のレス(J・K)→ 次/前のスレを選ぶ、Enter で開く、1 画面分(Space・PageDown)、先頭・末尾(Home・G・End・Shift+G)、
  // 半画面(D・U)、更新(R)、検索(/)、スレ立て(書き込み欄へ の W・E)、選んでいるスレの ☆(S)と URL のコピー(Y)。
  // スレ表示だけの操作(未読へ・画像一覧 など)と、アプリ全体の操作(App.tsx が受ける)はここでは受けない
  /** キーを読むもの(「G G」を見分ける) */
  const readKey = useRef(createKeyReader())
  const onListKey = useEvent((e: KeyboardEvent) => {
    if (modalOpen()) return // ダイアログが開いている間は、後ろの画面を動かさない
    if (e.defaultPrevented || isReloadKey(e)) return
    const t = e.target as HTMLElement | null
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName))) return
    const el = scrollRef.current
    if (!el) return
    // 割り当てがなくても、PageUp・PageDown・Home・End はスクロールに使う
    const fallback: Record<string, string> = { PageDown: 'pageDown', PageUp: 'pageUp', Home: 'top', End: 'bottom' }
    const action = (props.keymap && readKey.current(props.keymap, e)) ?? fallback[e.key]
    if (!action) {
      // 数字キー: 1 で未読だけ、2 で勢い順、3 で新しい順(押すたびに上の帯のボタンと同じく切り替わる)
      if (e.ctrlKey || e.altKey || e.metaKey || !/^[1-3]$/.test(e.key)) return
      e.preventDefault()
      if (e.key === '1') setUnreadOnly((v) => !v)
      else setSort((s) => cycleSort(s, e.key === '2' ? 'momentum' : 'newest'))
      return
    }
    const view = el.clientHeight - (headerRef.current?.offsetHeight ?? 0)
    const page = view - 40
    const cur = ordered.find((x) => threadId(x) === cursorId)
    if (action === 'nextPost' || action === 'prevPost') moveCursor(action === 'nextPost' ? 1 : -1)
    else if (action === 'openPost' && cur) props.onOpen(cur)
    else if (action === 'pageDown' || action === 'pageUp') el.scrollBy({ top: action === 'pageDown' ? page : -page })
    else if (action === 'halfDown' || action === 'halfUp') el.scrollBy({ top: action === 'halfDown' ? view / 2 : -view / 2 })
    else if (action === 'favorite' && cur && props.onToggleFavoriteThread) props.onToggleFavoriteThread(cur)
    else if (action === 'copyUrl' && cur && props.threadUrl) void navigator.clipboard.writeText(props.threadUrl(cur))
    else if (action === 'top') {
      el.scrollTo({ top: 0 })
      setCursorId(ordered[0] && threadId(ordered[0]))
    } else if (action === 'bottom') {
      el.scrollTo({ top: el.scrollHeight })
      const last = ordered[ordered.length - 1]
      setCursorId(last && threadId(last))
    } else if (action === 'refresh' && props.onRefresh) void props.onRefresh()
    else if (action === 'reply' && props.onNewThread) props.onNewThread() // スレ一覧の「書き込む」はスレ立て
    else if (action === 'search') {
      setSearchActive(true)
      requestAnimationFrame(() => searchRef.current?.focus())
    } else return
    e.preventDefault()
  })
  useEffect(() => {
    if (props.active === false) return
    window.addEventListener('keydown', onListKey)
    return () => window.removeEventListener('keydown', onListKey)
  }, [props.active, onListKey])
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
  // スレ一覧の更新は板全体を取り直すので、スレ表示より引っぱる量を多くする。
  // 続けて更新しないよう、手で更新したあとのクールダウン中(App が決める)は数えない
  const refreshReadyRef = useRef(props.refreshReadyAt)
  refreshReadyRef.current = props.refreshReadyAt
  const pull = useWheelPullRefresh({
    onRefresh: () => props.onRefresh?.(),
    sign: 1,
    // スレ表示(200 / 400)の 1.7 倍
    revealThreshold: 340,
    commitThreshold: 680,
    canRefresh: () => Date.now() >= (refreshReadyRef.current ?? 0),
  })

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

  // ── キー操作で選んでいるスレ(J・K で動かし、Enter で開く) ──
  /** 画面に並んでいる順のスレ(キーワードのまとまりがあれば、その順) */
  const ordered = useMemo(
    () => (keywordGroups ? [...keywordGroups.groups.flatMap((g) => g.threads), ...keywordGroups.rest] : visible),
    [keywordGroups, visible],
  )
  const [cursorId, setCursorId] = useState<string>()
  /** 選んでいるスレを 1 つ動かす。まだ選んでいなければ、画面に見えている一番上のスレから始める */
  const moveCursor = (d: 1 | -1) => {
    if (ordered.length === 0) return
    const i = ordered.findIndex((t) => threadId(t) === cursorId)
    if (i >= 0) return setCursorId(threadId(ordered[Math.min(ordered.length - 1, Math.max(0, i + d))]))
    const box = scrollRef.current
    const limit = (box?.getBoundingClientRect().top ?? 0) + headerHeight
    const cards = [...(box?.querySelectorAll<HTMLElement>('[data-thread-id]') ?? [])]
    const first = cards.find((c) => c.getBoundingClientRect().bottom > limit)?.dataset.threadId
    setCursorId(first ?? threadId(ordered[0]))
  }
  // 選んだスレが見えるようにスクロールする(上はヘッダーに隠れない位置まで)
  useEffect(() => {
    const box = scrollRef.current
    const el = box?.querySelector<HTMLElement>('[data-cursor]')
    if (!box || !el) return
    const r = el.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    const above = r.top - (b.top + headerHeight) - 8
    const below = r.bottom - b.bottom + 8
    if (above < 0) box.scrollBy({ top: above })
    else if (below > 0) box.scrollBy({ top: below })
  }, [cursorId])

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

  // ヘッダー・フッター・︙ に並べる操作。どこに置くかは設定(ボタンの配置)で決まる
  const placements = props.placements
  const barActions: BarAction[] = [
    { id: 'search', label: 'スレッド検索', icon: 'search', tint: 'var(--c-accent)', active: searchActive, onClick: () => setSearchActive((v) => !v) },
    ...(props.onNewThread
      ? [{ id: 'newThread', label: 'スレを立てる', icon: 'edit_square', tint: 'var(--c-mark-new)', onClick: props.onNewThread }]
      : []),
    ...(props.favorite
      ? [
          {
            id: 'favorite',
            label: props.favorite.active ? 'お気に入り板から外す' : 'お気に入り板に追加',
            icon: 'star',
            active: props.favorite.active,
            activeColor: 'var(--c-mark-fav)',
            tint: 'var(--c-mark-fav)',
            fillWhenActive: true,
            onClick: props.favorite.onToggle,
          },
        ]
      : []),
    ...(props.style
      ? [
          {
            id: 'style',
            label: '表示スタイル',
            icon: 'palette',
            tint: 'var(--c-mark-purple)',
            render: (where: 'header' | 'footer') => props.style!.button(where === 'footer'),
            submenu: props.style.items,
          },
        ]
      : []),
    ...(props.onRefresh
      ? [
          {
            id: 'refresh',
            label: 'スレッド一覧を更新',
            icon: 'refresh',
            tint: 'var(--c-accent)',
            // 押せるかは押した時点で決める(クールダウン中なら App が取りに行かない。残りは帯の更新ボタンに出る)
            disabled: props.loading,
            onClick: () => void props.onRefresh?.(),
            render: () => (
              <RefreshButton
                onClick={() => void props.onRefresh?.()}
                loading={props.loading}
                readyAt={props.refreshReadyAt}
                cooldownMs={LIST_REFRESH_COOLDOWN_MS}
                size={18}
                className={LIST_BTN}
              />
            ),
          },
        ]
      : []),
  ]
  const hasFooter = barActions.some((a) => placements[a.id] === 'footer')

  const onSelectCard = useEvent((t: ThreadSummary, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s)
      if (on) next.add(threadId(t))
      else next.delete(threadId(t))
      return next
    }),
  )

  const renderThread = (t: ThreadSummary) => {
    const id = threadId(t)
    return (
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
        isNew={props.newSince !== undefined && (t.createdAt?.getTime() ?? 0) > props.newSince}
        onToggleFavorite={props.onToggleFavoriteThread ? onFavoriteCard : undefined}
        isCursor={props.active !== false && cursorId === id}
        selected={selectable ? selected.has(id) : undefined}
        onSelect={selectable ? onSelectCard : undefined}
      />
    )
  }

  return (
    <section
      style={props.fill ? { width: '100%', maxWidth: props.fill === 'centered' ? FILL_MAX_WIDTH : undefined } : { width }}
      className={`flex-shrink-0 flex flex-col relative overflow-hidden bg-panel-list ${
        props.fill === 'centered' ? 'border-x' : props.fill ? '' : 'border-r'
      } border-c-border`}
    >
      {!props.fill && (
        <div
          className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-c-accent/30 transition-colors z-20"
          onMouseDown={onResizeStart}
        />
      )}

      <div
        ref={pull.indicatorRef}
        className="absolute left-0 right-0 flex justify-center pointer-events-none z-20"
        style={{ top: headerHeight, opacity: 0, transform: `translateY(${PULL_HIDDEN_Y}px)` }}
      >
        <PullSpinner iconRef={pull.iconRef} />
      </div>
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto custom-scrollbar thick-scrollbar flex flex-col"
        onScroll={pull.noteScroll}
        onWheel={(e) => {
          if (props.pullToRefresh && props.onRefresh && e.deltaY < 0 && (scrollRef.current?.scrollTop ?? 1) < 1) pull.pull(-e.deltaY)
        }}
      >
        <div ref={headerRef} className="sticky top-0 z-10 frosted-glass flex-shrink-0">
          <div className="p-4">
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0 h-11">
                {/* 板名の帯全体が押せる(板名が短くても、帯のどこを押しても先頭へ) */}
                <h2
                  className={`group/title absolute inset-0 flex items-center min-w-0 font-bold text-c-text-strong text-xl cursor-pointer transition-opacity duration-200 ${
                    searchActive ? 'opacity-0 pointer-events-none' : 'opacity-100'
                  }`}
                  onClick={() => scrollRef.current?.scrollTo({ top: 0 })}
                  title="クリックで先頭へスクロール"
                >
                  <span className="truncate group-hover/title:text-c-accent transition-colors">{props.title}</span>
                </h2>
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onBlur={() => {
                    if (!query.trim()) setSearchActive(false)
                  }}
                  onKeyDown={(e) => {
                    // Esc: 検索を外して欄から抜け、スレ一覧のキー操作に戻る(日本語の変換中の Esc は変換の取り消し)
                    if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      setQuery('')
                      setSearchActive(false)
                      e.currentTarget.blur()
                    }
                  }}
                  placeholder="スレッド検索..."
                  className={`absolute inset-y-0 right-0 h-9 my-auto bg-c-surface border border-c-border rounded-[var(--card-radius)] px-3 text-sm text-c-text-body placeholder-c-text-muted focus:outline-none transition-[width,opacity] duration-300 ease-out ${
                    searchActive ? 'w-full opacity-100' : 'w-0 opacity-0 pointer-events-none'
                  }`}
                />
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <ActionButtons actions={barActions} placements={placements} where="header" btnClass={LIST_BTN} iconClass="text-lg" />
                <MoreMenu actions={barActions} btnClass={LIST_BTN} iconClass="text-lg" />
              </div>
            </div>
          </div>

          {selectable && selected.size > 0 && (
            <div className="flex items-center gap-2 px-4 py-1.5 border-b border-c-border text-xs">
              <span className="text-c-text-muted">{selected.size} 件選択中</span>
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
            </div>
          )}
          <div className="flex items-stretch px-4 border-b border-c-border text-sm font-medium">
            {/* すべて選ぶ・すべて外す(一部だけのときは「－」)。各スレのチェックボックスと縦にそろうよう、未読の左に置く */}
            {selectable && (
              <label className="flex items-center pr-3 cursor-pointer" title="すべて選択">
                <input
                  type="checkbox"
                  ref={(el) => {
                    if (el) el.indeterminate = selected.size > 0 && selected.size < visible.length
                  }}
                  checked={visible.length > 0 && selected.size === visible.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(visible.map(threadId)) : new Set())}
                  className="rounded"
                />
              </label>
            )}
            <div className="flex-1 grid grid-cols-3">
              <button
                type="button"
                onClick={() => setUnreadOnly((v) => !v)}
                className={`${TAB} ${unreadOnly ? 'text-c-accent' : 'text-c-text-muted hover:text-c-text-body'}`}
                title="ログがあり、新着レスのあるスレだけを出す(1 キー)"
              >
                <span className="material-symbols-outlined text-base leading-none">mark_email_unread</span>
                未読
                {unreadTotal > 0 && (
                  <span
                    className="font-bold text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap"
                    style={{ background: 'var(--c-unread)', color: 'var(--c-unread-text)' }}
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
                    title={`${label}に並べる。押すたびに 逆順 → 元の並び(${mode === 'momentum' ? 2 : 3} キー)`}
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
      {/* フッター。ボタンの配置で「フッター」にした操作だけ並べる(なければ出さない) */}
      {hasFooter && (
        <div className="flex-shrink-0 h-10 px-3 flex items-center justify-end gap-1 border-t border-c-border">
          <ActionButtons actions={barActions} placements={placements} where="footer" btnClass={LIST_BTN} iconClass="text-lg" />
        </div>
      )}
    </section>
  )
}

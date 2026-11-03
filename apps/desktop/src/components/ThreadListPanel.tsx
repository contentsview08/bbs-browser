// スレ一覧パネル。web 版の ThreadListPanel.tsx(PC 版)の見た目を移植。
// 板のスレ一覧と閲覧履歴の両方をこのパネルで出す。

import { useLayoutEffect, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ThreadSummary } from '@bbs-browser/connectors'
import type { ThreadState } from '@bbs-browser/logstore'
import ThreadCard from './ThreadCard'
import LoadingCenter from './LoadingCenter'
import LoadFailed from './LoadFailed'
import PullSpinner from './PullSpinner'
import { useWheelPullRefresh } from '../hooks/useWheelPullRefresh'
import RefreshButton from './RefreshButton'
import { ActionButtons, MOBILE_HEAD_BTN, MOBILE_HEAD_ICON, MoreMenu, type BarAction } from './ActionBar'
import { inBar, mobileMenuActions, orderBy, type Placement } from '../utils/toolbar'
import ActionSheet, { type SheetItem } from './ActionSheet'
import { SliderDialog } from './FontSizeSlider'
import { LIST_REFRESH_COOLDOWN_MS } from '../utils/cooldown'
import { PULL_HIDDEN_Y } from '../utils/pullRefresh'
import { momentum, rankMomentum } from '../utils/thread'
import { isMobile } from '../utils/platform'
import { useHideOnScroll } from '../hooks/useHideOnScroll'
import { useTouchPull } from '../hooks/useTouchPull'
import { LIST_TABS, VIEWED_TAB, type ListTabKey, type TabLabel, type ThreadSort } from '../ui/settings'
import { normalizeForSearch } from '../utils/postBody'
import { createKeyReader, modalOpen, isReloadKey, type Keymap } from '../utils/keymap'
import { useEvent } from '../hooks/useEvent'
import { animateScroll } from '../hooks/useThreadScroll'
import { useDragHeight } from '../hooks/useDragHeight'
import DragEdge from './DragEdge'
import PeekPopup from './PeekPopup'
import { followDelta, isDoublePress, isNear, isSeen, pickAfterPage, stepCursor, type Span } from '../utils/cursor'

export type SortMode = 'momentum' | 'newest' | 'count'
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
  /** 読み込めなかった理由。一覧が空のときは、取り直しのボタンと一緒に出す */
  errorText?: string
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
  /** ヘッダー(板名の行)とフッターの高さ(px。0 なら既定)と、変えたときの保存 */
  headerHeight?: number
  footerHeight?: number
  onHeaderHeight?: (height: number) => void
  onFooterHeight?: (height: number) => void
  /** カードの見た目(レスの見た目の設定に合わせる) */
  variant?: 'card' | 'discord' | 'classic' | 'line'
  /** 立てた人の ID(エッジ)を模様で出す。切っていれば、右下に ID を小さく出す */
  authorIcon?: boolean
  /** 行の形がコンパクト(スレタイ 1 行と数だけ。設定 listShape) */
  compact?: boolean
  /** 表示スタイルのメニュー。帯に置くボタン(up ならメニューを上に開く)と、︙ の中に出す中身 */
  style?: { button: (up: boolean) => ReactNode; items: ReactNode }
  /** ︙ の「文字の大きさ」の中身(スレ一覧の大きさのスライダー) */
  fontSize?: ReactNode
  /** 操作ボタンの置き場所(設定) */
  placements: Record<string, Placement>
  /** ボタンの並び(設定で並べ替えたとき) */
  barOrder?: string[]
  /** 最初の並び順(設定) */
  defaultSort: ThreadSort
  /**
   * いまの threads がサーバーで並べ替え済みのときの、その並び(ふたばのカタログの勢順など)。
   * 選んだ並びと同じなら手元では並べ替えず、向きだけ違えば逆にする
   */
  serverOrder?: { mode: SortMode; dir: 'desc' | 'asc' }
  /** 並びを変えた(サーバーに並べ替えを頼める掲示板なら、App が一覧を取り直す) */
  onSortChange?: (sort: { mode: SortMode; dir: 'desc' | 'asc' } | null) => void
  /** 見えているスレの並び(絞り込み・並べ替えのあと)が変わった。スレの最後の「次の未読スレへ」がこの順で探す */
  onShownChange?: (list: ThreadSummary[]) => void
  /** ヘッダーの下に置く帯(履歴の切り替えなど)。スマホではヘッダーと一緒に隠れる */
  subHeader?: ReactNode
  /** 一覧の代わりに出す中身(履歴の書き込み・画像)。渡したときは、スレの並び・タブ・検索を出さない */
  body?: ReactNode
  /** 閲覧履歴の行に出すもの(板の名前・いつ見たか)。渡すと、行が履歴用の形になる */
  historyMetaOf?: (t: ThreadSummary) => { boardName: string; readAt?: number; icon?: string }
  /** 裏で取っている間の文(閲覧履歴の新着を板ごとに確かめている など)。タブの行の右に小さく出す(一覧はずらさない) */
  busyText?: string
  /** 1 ページに出すスレの数(0 なら全部)。絞り込み・検索のあとで分ける */
  pageSize?: number
  /** 上に出すタブと、その並び(設定の listTabs) */
  tabs?: ListTabKey[]
  /** タブの見せ方(アイコンと文字・アイコンだけ・文字だけ) */
  tabLabel?: TabLabel
  /** スレタイの NG に当たるスレは出さない */
  isNg: (t: ThreadSummary) => boolean
  /**
   * 「未読」で絞り込んだスレの顔ぶれを控え直すきっかけ。これが変わるまでは、読み終えたスレも並べ続ける。
   * 渡さなければ、スレ一覧(threads)を取り直したときに控え直す
   */
  snapshotKey?: unknown
  /** これが変わったら「未読」の絞り込みにする(サイドバーの「未読のスレ」から開いたとき) */
  unreadRequest?: number
  /** 興味のあるキーワード。スレタイに含むスレを、キーワードの帯の下にまとめて上に出す */
  keywords?: string[]
  /** スレタイを NG に追加する画面を開く */
  /** スレを NG にする画面を出す(スレタイと、分かれば立てた人の ID を入れて) */
  onNgThread?: (t: ThreadSummary) => void
  /** 立てた人を NG に追加 */
  onNgAuthor?: (t: ThreadSummary) => void
  /** スレのログ(閲覧履歴)を消す */
  onDeleteThreadLog?: (t: ThreadSummary) => void
  /** スレのブラウザ用の URL(コピーに使う) */
  threadUrl?: (t: ThreadSummary) => string
  /** 渡されたときだけ、チェックボックスで選んでまとめてログを消せる(閲覧履歴) */
  onDeleteLogs?: (threads: ThreadSummary[]) => void
  /** スレを立てられる板のときだけ渡す */
  onNewThread?: () => void
  /** スマホ: サイドバーの引き出しを開く */
  onOpenDrawer?: () => void
  /** お気に入りのスレ(threadId の集まり)と、足す・外す */
  favoriteIds?: Set<string>
  onToggleFavoriteThread?: (t: ThreadSummary) => void
  /** 手で更新したあとのクールダウンが明ける時刻(更新ボタンに残りを出し、引っぱっても数えない) */
  refreshReadyAt?: number
  /** この時刻より後に立ったスレに「新」の印を付ける(前回その板の一覧を取った時刻) */
  newSince?: number
  /** 一番上でさらにホイールを回したら更新する(設定) */
  pullToRefresh: boolean
  /** スマホ: 下へスクロールしたらヘッダーとフッターを隠す */
  hideBarsOnScroll?: boolean
  /** 板を開いているときだけ ★ を出す */
  favorite?: { active: boolean; onToggle: () => void }
  /** 板の URL(板のスレ一覧のとき。板名を押して出すメニューのコピー・ブラウザで開くに使う) */
  boardUrl?: string
  /** 外のブラウザで開く */
  onOpenExternal?: (url: string) => void
}

/** 1 画面のとき、スレ一覧を広げる幅の上限(これより広いと 1 行が長くて読みにくい) */
const FILL_MAX_WIDTH = 820
const LIST_BTN = 'p-1.5 text-c-text-muted hover:text-c-text-strong transition-colors rounded-lg'
/** スレ一覧で最初に作るカードの数と、そのあと 1 回で作り足す数、まだ作っていないカードの見込みの高さ(px) */
const FIRST_CARDS = 60
const CARD_CHUNK = 150
const CARD_ESTIMATE = 64

/**
 * 運営のお知らせ・広告のスレか。コネクタの印に加えて、手元に残っていた古い一覧(印のないもの)のために、
 * 5ch と同じ「番号が日時にするとずっと先」のスレも数える
 */
const isAnnouncement = (t: ThreadSummary) => !!t.announcement || (/^\d{10}$/.test(t.key) && Number(t.key) * 1000 > Date.now() + 86_400_000)
/** J・K で選んだスレへ送るときのスクロールの時間と、画面の上下に残す余白の割合(スレ表示と同じ) */
const CURSOR_SCROLL_MS = 160
const CURSOR_MARGIN = 0.25
/** Esc の 2 回押しとみなす間隔 */
const DOUBLE_ESC_MS = 500
const TAB = 'relative flex items-center justify-center gap-1 py-2.5 transition-colors whitespace-nowrap'

export default function ThreadListPanel(props: Props) {
  const { threads, stateOf } = props
  const defaultSort: SortState = props.defaultSort === 'subject' ? null : { mode: props.defaultSort, dir: 'desc' }
  const [sort, setSort] = useState<SortState>(defaultSort)
  const onSortChange = useRef(props.onSortChange)
  onSortChange.current = props.onSortChange
  useEffect(() => {
    onSortChange.current?.(sort)
  }, [sort])
  const [unreadOnly, setUnreadOnly] = useState(false)
  /** 閲覧済み(ログのある)スレだけを出す */
  const [visitedOnly, setVisitedOnly] = useState(false)
  /** 上に出すタブ(設定の並び) */
  const tabs = props.tabs ?? ['unread', 'momentum', 'newest']
  /** タブを押した(数字キーも同じ): 絞り込みは付け外し、並べ替えは 多い順 → 逆順 → 元の並び */
  /** 閲覧履歴の「見た順」を逆にしている(最近見たものが下) */
  const [reversed, setReversed] = useState(false)
  // タブはどれか 1 つだけを選ぶ(未読を選んでいて勢い順を押したら、未読の絞り込みは外れる)
  const pressTab = (key: ListTabKey) => {
    if (key === 'unread' || key === 'visited') {
      const on = !(key === 'unread' ? unreadOnly : visitedOnly)
      setUnreadOnly(key === 'unread' && on)
      setVisitedOnly(key === 'visited' && on)
      // 絞り込みを選んだら、並べ替えは元の並びに戻す
      if (on) {
        setSort(defaultSort)
        setReversed(false)
      }
      return
    }
    setUnreadOnly(false)
    setVisitedOnly(false)
    if (key === 'viewed') {
      // 見た順: 選んでいなければ選ぶだけ、選んでいれば上下を入れ替える
      if (!sort && !unreadOnly && !visitedOnly) setReversed((v) => !v)
      setSort(null)
    } else setSort((s) => cycleSort(s, key))
  }
  const [searchActive, setSearchActive] = useState(false)
  const [query, setQuery] = useState('')
  useEffect(() => {
    if (!props.unreadRequest) return
    setUnreadOnly(true)
    setVisitedOnly(false)
    setSort(defaultSort)
    setReversed(false)
  }, [props.unreadRequest])

  // Esc：未読だけ・並べ替え・検索を外して、いつもの並びに戻す。
  // 入力欄の中の Esc と、スレ表示が先に使った Esc(ポップアップを閉じた・絞り込みを解いた)には手を出さない。
  // スレ表示の受け取りと順番が決まらないので、ほかの受け取りが済んでから(マイクロタスクで)見る
  /** 外すものがあれば外して true。なければ何もしないで false */
  const resetView = useEvent((): boolean => {
    // スマホ: 選んでいる途中なら、まず選ぶのをやめる(戻るで)
    if (selected.size > 0) {
      setSelected(new Set())
      return true
    }
    const sorted = JSON.stringify(sort) !== JSON.stringify(defaultSort)
    if (!unreadOnly && !visitedOnly && !sorted && !query && !searchActive && !reversed) return false
    setReversed(false)
    setUnreadOnly(false)
    setVisitedOnly(false)
    setSort(defaultSort)
    setQuery('')
    setSearchActive(false)
    return true
  })
  /** 外すものがないときに Esc を 2 回(素早く)押したら、選んでいるスレの印を隠す(スレ表示と同じ。選んでいる場所は残す) */
  const lastEsc = useRef(0)
  const escNothing = useEvent(() => {
    const now = Date.now()
    if (isDoublePress(lastEsc.current, now, DOUBLE_ESC_MS)) {
      setCursorHidden(true)
      lastEsc.current = 0
    } else lastEsc.current = now
  })
  useEffect(() => {
    if (props.active === false) return
    const onKey = (e: KeyboardEvent) => {
      if (modalOpen()) return // ダイアログが開いている間は、後ろの画面を動かさない
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      queueMicrotask(() => {
        if (!e.defaultPrevented && !resetView()) escNothing()
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.active, resetView, escNothing])

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
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
    // ボタンやリンクにフォーカスがあっても、キー操作は効かせる。Enter だけは、そのボタンを押すのに使う
    if (e.key === 'Enter' && t && (/^(BUTTON|A)$/.test(t.tagName) || t.getAttribute('role') === 'button')) return
    const el = scrollRef.current
    if (!el) return
    // 割り当てがなくても、PageUp・PageDown・Home・End はスクロールに使う
    const fallback: Record<string, string> = { PageDown: 'pageDown', PageUp: 'pageUp', Home: 'top', End: 'bottom' }
    const action = (props.keymap && readKey.current(props.keymap, e)) ?? fallback[e.key]
    if (!action) {
      // 数字キー: 上のタブの左から 1・2・3…(押すたびに、タブを押したのと同じく切り替わる)
      if (e.ctrlKey || e.altKey || e.metaKey || !/^[1-9]$/.test(e.key)) return
      const tab = tabs[Number(e.key) - 1]
      if (!tab) return
      e.preventDefault()
      pressTab(tab)
      return
    }
    const cur = ordered.find((x) => threadId(x) === cursorId)
    keyRepeat.current = e.repeat
    if (action === 'nextPost' || action === 'prevPost') moveCursor(action === 'nextPost' ? 1 : -1)
    else if (action === 'openPost' && cur) {
      setCursorHidden(false)
      props.onOpen(cur)
    } else if (action === 'pageDown' || action === 'pageUp') pageWithCursor(action === 'pageDown' ? 1 : -1, false)
    else if (action === 'halfDown' || action === 'halfUp') pageWithCursor(action === 'halfDown' ? 1 : -1, true)
    else if (action === 'favorite' && cur && props.onToggleFavoriteThread) props.onToggleFavoriteThread(cur)
    else if (action === 'copyUrl' && cur && props.threadUrl) void navigator.clipboard.writeText(props.threadUrl(cur))
    else if (action === 'peek' && cur) {
      // スレ一覧に中身が一緒に届いた掲示板だけのぞける(のぞくために取りに行くことはしない)
      if (cur.preview?.length) setPeek(cur)
      else showNote('この掲示板は、スレを開かずに中身をのぞけません(スレ一覧に中身が入っていないため)')
    }
    else if (action === 'top') {
      animateScroll(el, () => 0, 0)
      setCursorHidden(false)
      setCursorId(ordered[0] && threadId(ordered[0]))
    } else if (action === 'bottom') {
      animateScroll(el, () => el.scrollHeight, 0)
      setCursorHidden(false)
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
  // ヘッダー(板名の行)とフッターの高さ(端をつかんで変える)
  const titleRowRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)
  const headerDrag = useDragHeight(props.headerHeight ?? 0, (h) => props.onHeaderHeight?.(h), { min: 32, max: 160 })
  const footerDrag = useDragHeight(props.footerHeight ?? 0, (h) => props.onFooterHeight?.(h), { min: 28, max: 120 })
  const scrollRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  // スマホ: 下へスクロールするとヘッダーとフッターを隠し、上へスクロールすると戻す
  const hideBars = useHideOnScroll(headerRef, footerRef)
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
    // スレ表示(120 / 240)の 1.4 倍
    revealThreshold: 170,
    commitThreshold: 340,
    canRefresh: () => Date.now() >= (refreshReadyRef.current ?? 0),
  })
  // スマホ: 指で引っぱって更新する(上の端で下へ。しきい値がスレ表示の 1.7 倍なので、指の量も多めに掛ける)
  // 選んでいる間(閲覧履歴を長押しで選んで、なぞっているときなど)は、引っぱって更新しない
  const touchPull = useTouchPull(scrollRef, props.pullToRefresh && props.onRefresh && selected.size === 0 ? pull : undefined, undefined)

  useEffect(() => {
    setWidth(props.width)
  }, [props.width])
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
  /** 「読んだスレを片づける」を押した回数(控え直すきっかけ) */
  const [sweepCount, setSweepCount] = useState(0)
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
  }, [unreadOnly, snapshotKey, sweepCount])
  /** 「未読」に残っている、読み終えたスレの数(「読んだスレを片づける」で外す) */
  const readInSnapshot = unreadSnapshot
    ? threads.filter((t) => {
        if (!unreadSnapshot.has(threadId(t))) return false
        const st = stateOf(t)
        return st !== undefined && st.readNo >= t.postCount
      }).length
    : 0

  // 並べ替え・一覧の入れ替えは、タブの印(どれを選んだか)を先に描き、並べ直したカードの組み立ては後回しにする。
  // カードが多いと組み立てに時間がかかり、押してから印が変わるまで固まったように見えるため
  const shownSort = useDeferredValue(sort)
  const shownThreads = useDeferredValue(threads)
  // サーバーの並び(ふたば)は一覧と一緒に変わるので、一緒に遅らせる(ずれると、一瞬だけ並べ替えていない一覧が出る)
  const shownServerOrder = useDeferredValue(props.serverOrder)
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = shownThreads.filter((t) => {
      if (props.isNg(t)) return false
      if (q && !t.title.toLowerCase().includes(q)) return false
      if (unreadOnly && !(unreadSnapshot?.has(threadId(t)) ?? false)) return false
      if (visitedOnly && stateOf(t) === undefined) return false
      return true
    })
    const so = shownServerOrder
    if (shownSort && so && so.mode === shownSort.mode) {
      // サーバーが並べ替えた順をそのまま使う(手元の勢いの計算はサーバーと違うので、並べ替え直さない)
      if (so.dir !== shownSort.dir) list = [...list].reverse()
    } else if (shownSort) {
      const sign = shownSort.dir === 'desc' ? -1 : 1
      const value = (t: ThreadSummary) =>
        shownSort.mode === 'momentum' ? (momenta.get(threadId(t)) ?? 0) : shownSort.mode === 'count' ? t.postCount : (t.createdAt?.getTime() ?? 0)
      list = [...list].sort((a, b) => (value(a) - value(b)) * sign)
    }
    // 閲覧履歴の「見た順」を逆にしたら、最近見たものを下に
    if (reversed && !shownSort) list = [...list].reverse()
    // 運営のお知らせ・広告のスレは、どの並べ方でも一番下に回す(並びはそのまま)
    if (list.some(isAnnouncement)) list = [...list.filter((t) => !isAnnouncement(t)), ...list.filter(isAnnouncement)]
    return list
  }, [shownThreads, query, unreadOnly, visitedOnly, unreadSnapshot, shownSort, props.isNg, momenta, stateOf, shownServerOrder, reversed])
  const onShownChange = useRef(props.onShownChange)
  onShownChange.current = props.onShownChange
  // visible は App が描き直すたびに作り直される(stateOf が毎回新しい)ので、顔ぶれ・並び・レス数が変わったときだけ知らせる。
  // visible を見て知らせると、App の描き直し → 新しい visible → また知らせる、が止まらなくなる
  const shownKey = visible.map((t) => `${threadId(t)}:${t.postCount}`).join('\n')
  useEffect(() => {
    onShownChange.current?.(visible)
  }, [shownKey])

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
  // ページ: 並び(ordered)を pageSize ごとに分ける。並び・絞り込み・検索が変わったら 1 ページ目へ
  const [page, setPage] = useState(0)
  const pageSize = props.pageSize ?? 0
  const paged = pageSize > 0 && ordered.length > pageSize
  const pageCount = paged ? Math.ceil(ordered.length / pageSize) : 1
  const pageSafe = Math.min(page, pageCount - 1)
  const pageItems = paged ? ordered.slice(pageSafe * pageSize, (pageSafe + 1) * pageSize) : undefined
  useEffect(() => {
    setPage(0)
  }, [visible])
  const goPage = (n: number) => {
    setPage(Math.max(0, Math.min(pageCount - 1, n)))
    scrollRef.current?.scrollTo({ top: 0 })
  }
  const [cursorId, setCursorId] = useState<string>()
  /** 中身をのぞいているスレ(P) */
  const [peek, setPeek] = useState<ThreadSummary>()
  /** 短い知らせ(のぞけないときなど)。少しして消す */
  const [note, setNote] = useState<string>()
  const noteTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const showNote = (text: string) => {
    setNote(text)
    clearTimeout(noteTimer.current)
    noteTimer.current = setTimeout(() => setNote(undefined), 3000)
  }
  useEffect(() => () => clearTimeout(noteTimer.current), [])
  /** スマホ: 板名を押して出す、板の操作のメニュー */
  const [titleSheet, setTitleSheet] = useState(false)
  /** ︙ の「文字の大きさ・余白」の画面 */
  const [fontDialog, setFontDialog] = useState(false)
  const copyText = (text: string, done: string) =>
    void navigator.clipboard.writeText(text).then(
      () => showNote(done),
      () => showNote('コピーできませんでした'),
    )
  /** Esc 2 回で、選んでいるスレの印を隠しているか(選んでいる場所は残す) */
  const [cursorHidden, setCursorHidden] = useState(false)
  /** いまのキーが、押し続けたときの自動の連打か(押し続けている間はアニメーションしない) */
  const keyRepeat = useRef(false)
  /** 並んでいるカードと、見えている範囲(ヘッダーの下から画面の下まで) */
  const cardGeometry = () => {
    const box = scrollRef.current
    if (!box) return undefined
    const b = box.getBoundingClientRect()
    const viewTop = b.top + headerHeight
    const cards = [...box.querySelectorAll<HTMLElement>('[data-thread-id]')]
    const seen = cards.filter((c) => isSeen(spanOf(c), { top: viewTop, bottom: b.bottom }))
    return { box, b, viewTop, cards, seen }
  }
  /** 選んだカードが外に出るときだけ、上下に余白(CURSOR_MARGIN)を残して送る(スレ表示の J・K と同じ。utils/cursor.ts) */
  const followCard = (el: HTMLElement, d: 1 | -1) => {
    const g = cardGeometry()
    if (!g) return
    const delta = followDelta(spanOf(el), { top: g.viewTop, bottom: g.b.bottom }, d, CURSOR_MARGIN)
    if (delta === 0) return
    const anchor = el.getBoundingClientRect().top - delta
    animateScroll(g.box, () => g.box.scrollTop + el.getBoundingClientRect().top - anchor, keyRepeat.current ? 0 : CURSOR_SCROLL_MS)
  }
  /**
   * 選んでいるスレを 1 つ動かす。選んでいるスレが画面から大きく離れていたら(スクロールした)、見えている所から選び直す
   * (J は見えている一番上、K は一番下)。Esc 2 回で隠していたら、最初の 1 回は動かさずに出し直す
   */
  const moveCursor = (d: 1 | -1) => {
    const g = cardGeometry()
    if (!g || g.cards.length === 0) return
    const { b, viewTop, cards, seen } = g
    const i = cards.findIndex((c) => c.dataset.threadId === cursorId)
    const next = stepCursor({
      count: cards.length,
      current: i,
      onScreen: i >= 0 && isNear(spanOf(cards[i]), { top: viewTop, bottom: b.bottom }),
      hidden: cursorHidden,
      d,
      seen: seen.map((c) => cards.indexOf(c)),
    })
    setCursorHidden(false)
    if (next === undefined || next === 'stay') return
    const target = cards[next]
    setCursorId(target.dataset.threadId)
    followCard(target, d)
  }
  /** 1 画面・半画面送るとき、選ぶスレもいっしょに送る(選んでいたスレと同じ高さにあるスレを選ぶ。端なら端のスレ) */
  const pageWithCursor = (dir: 1 | -1, half: boolean) => {
    const g = cardGeometry()
    if (!g) return
    const { box, b, viewTop, cards, seen } = g
    setCursorHidden(false)
    const view = b.bottom - viewTop
    const cur = cards.find((c) => c.dataset.threadId === cursorId)
    const y = (cur && seen.includes(cur) ? Math.max(cur.getBoundingClientRect().top, viewTop) : viewTop) + 1
    const spans = cards.map(spanOf)
    const before = box.scrollTop
    box.scrollTop += dir * (half ? view / 2 : view - 40)
    const i = pickAfterPage(spans, y, box.scrollTop - before, dir)
    if (i !== undefined) setCursorId(cards[i].dataset.threadId)
  }


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
  // 押して開いたスレも選んだ状態にする(一覧に戻ったとき、どこを見ていたか分かり、J・K がそこから続く)
  const onOpenCard = useEvent((t: ThreadSummary) => {
    setCursorId(threadId(t))
    setCursorHidden(false)
    props.onOpen(t)
  })
  const onNgCard = useEvent((t: ThreadSummary) => props.onNgThread?.(t))
  const onNgAuthorCard = useEvent((t: ThreadSummary) => props.onNgAuthor?.(t))
  const onCopyCard = useEvent(
    (t: ThreadSummary) => void navigator.clipboard.writeText(props.threadUrl ? `${t.title}\n${props.threadUrl(t)}` : t.title),
  )
  const onDeleteCard = useEvent((t: ThreadSummary) => props.onDeleteThreadLog?.(t))
  const onFavoriteCard = useEvent((t: ThreadSummary) => props.onToggleFavoriteThread?.(t))

  // ヘッダー・フッター・︙ に並べる操作。どこに置くかは設定(ボタンの配置)で決まる
  const placements = props.placements
  const allBarActions: BarAction[] = [
    ...(props.onOpenDrawer ? [{ id: 'drawer', label: 'メニュー', icon: 'menu', onClick: props.onOpenDrawer }] : []),
    { id: 'top', label: '先頭へ', icon: 'vertical_align_top', onClick: () => scrollRef.current?.scrollTo({ top: 0 }) },
    { id: 'search', label: 'スレッド検索', icon: 'search', active: searchActive, onClick: () => setSearchActive((v) => !v) },
    ...(props.onNewThread
      ? [{ id: 'newThread', label: 'スレを立てる', icon: 'edit_square', onClick: props.onNewThread }]
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
    // 動かすと一覧の大きさが変わるので、メニューの中ではなく、真ん中に出す小さな画面で変える
    ...(props.fontSize ? [{ id: 'fontSize', label: '文字の大きさ・余白', icon: 'format_size', onClick: () => setFontDialog(true) }] : []),
    ...(props.style
      ? [
          {
            id: 'style',
            label: '表示スタイル',
            icon: 'palette',
            render: (where: Placement) => props.style!.button(inBar(where, 'footer')),
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
  // その画面(PC かスマホか)で使わない操作は、︙ の中にも出さない
  const barActions = orderBy(allBarActions.filter((a) => placements[a.id] !== undefined), props.barOrder)
  const hasFooter = barActions.some((a) => inBar(placements[a.id], 'footer'))

  const onSelectCard = useEvent((t: ThreadSummary, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s)
      if (on) next.add(threadId(t))
      else next.delete(threadId(t))
      return next
    }),
  )

  // ── スマホ: 長押しで選び始め、そのまま上下になぞると、なぞった範囲をまとめて選ぶ ──
  /** なぞって選んでいる途中: 長押ししたスレの位置と、なぞり始める前に選んでいたもの */
  const dragSelect = useRef<{ anchor: number; base: Set<string> } | null>(null)
  const orderedRef = useRef(ordered)
  orderedRef.current = ordered
  const onSelectStart = useEvent((t: ThreadSummary) => {
    const base = new Set(selected).add(threadId(t))
    setSelected(base)
    dragSelect.current = { anchor: ordered.findIndex((x) => threadId(x) === threadId(t)), base }
  })
  useEffect(() => {
    const el = scrollRef.current
    if (!isMobile || !el) return
    const move = (e: TouchEvent) => {
      const d = dragSelect.current
      if (!d || d.anchor < 0) return
      // なぞって選んでいる間は、一覧をスクロールさせない(画面の上下の端に来たら、少しずつ送る)
      e.preventDefault()
      const t = e.touches[0]
      const box = el.getBoundingClientRect()
      if (t.clientY < box.top + 72) el.scrollTop -= 12
      else if (t.clientY > box.bottom - 72) el.scrollTop += 12
      const card = document.elementFromPoint(t.clientX, t.clientY)?.closest<HTMLElement>('[data-thread-id]')
      const list = orderedRef.current
      const i = card ? list.findIndex((x) => threadId(x) === card.dataset.threadId) : -1
      if (i < 0) return
      const next = new Set(d.base)
      for (let k = Math.min(i, d.anchor); k <= Math.max(i, d.anchor); k++) next.add(threadId(list[k]))
      setSelected(next)
    }
    const end = () => {
      dragSelect.current = null
    }
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => {
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
    }
  }, [])

  // ── カードは上から少しずつ作る(数百スレある板でも、開いてすぐ出るように) ──
  // 最初は FIRST_CARDS 枚、そのあと手の空いたときに CARD_CHUNK 枚ずつ作り足す。板が変わると作り直す(この部品ごと作り直される)
  const [renderLimit, setRenderLimit] = useState(FIRST_CARDS)
  // 並べ替え・絞り込み・検索を変えたら、描く数を最初の分まで戻して先頭へ(1000 枚のカードの DOM を一度に並べ直すと重い。
  // 少しずつ描く仕組みが、並べ替えでは効いていなかった)。一覧の取り直し(threads が変わる)では戻さない(並びを保つ)
  const orderBasis = `${shownSort?.mode ?? ''}:${shownSort?.dir ?? ''}:${unreadOnly}:${visitedOnly}:${reversed}:${query}`
  const firstBasis = useRef(orderBasis)
  useLayoutEffect(() => {
    if (firstBasis.current === orderBasis) return
    firstBasis.current = orderBasis
    setRenderLimit(FIRST_CARDS)
    scrollRef.current?.scrollTo({ top: 0 })
  }, [orderBasis])
  useEffect(() => {
    if (renderLimit >= ordered.length) return
    const grow = () => setRenderLimit((n) => n + CARD_CHUNK)
    const idle = window.requestIdleCallback
    if (idle) {
      const id = idle(grow, { timeout: 300 })
      return () => window.cancelIdleCallback(id)
    }
    const t = setTimeout(grow, 30)
    return () => clearTimeout(t)
  }, [renderLimit, ordered.length])
  /** 並び順の何番目まで作るか数えながら、カードを作る(キーワードのまとまりをまたいでも、上からの順で数える) */
  let rendered = 0
  const renderLimited = (t: ThreadSummary) => (rendered++ < renderLimit ? renderThread(t) : null)

  const renderThread = (t: ThreadSummary) => {
    const id = threadId(t)
    return (
      <ThreadCard
        key={id}
        thread={t}
        state={stateOf(t)}
        isActive={!isMobile && props.activeId === id}
        momentum={momenta.get(id) ?? 0}
        momentumRank={ranks.get(id) ?? 0}
        onOpen={onOpenCard}
        onNg={props.onNgThread ? onNgCard : undefined}
        onNgAuthor={props.onNgAuthor ? onNgAuthorCard : undefined}
        onCopy={onCopyCard}
        onDeleteLog={props.onDeleteThreadLog ? onDeleteCard : undefined}
        isFavorite={props.favoriteIds?.has(id) ?? false}
        isNew={props.newSince !== undefined && (t.createdAt?.getTime() ?? 0) > props.newSince}
        onToggleFavorite={props.onToggleFavoriteThread ? onFavoriteCard : undefined}
        isCursor={!isMobile && props.active !== false && !cursorHidden && cursorId === id}
        variant={props.variant}
        authorIcon={props.authorIcon}
        compact={props.compact}
        selected={selectable ? selected.has(id) : undefined}
        onSelect={selectable ? onSelectCard : undefined}
        selecting={selected.size > 0}
        onSelectStart={selectable && isMobile ? onSelectStart : undefined}
        historyMeta={props.historyMetaOf?.(t)}
      />
    )
  }

  // 未読・勢い順などのタブ。PC はヘッダーの下、スマホはフッターの左に置く
  const tabGrid = (
            <div
              // スマホ(フッターの左)は、左から詰めて並べる。PC は幅いっぱいに等分する
              className={isMobile ? 'flex items-stretch gap-4 pl-2' : 'flex-1 grid'}
              style={isMobile ? undefined : { gridTemplateColumns: `repeat(${Math.max(1, tabs.length)}, minmax(0, 1fr))` }}
            >
              {tabs.map((key, i) => {
                const def = key === 'viewed' ? VIEWED_TAB : LIST_TABS.find((t) => t.key === key)!
                const filter = key === 'unread' || key === 'visited'
                // 見た順は、並べ替えていないあいだずっと選んでいる(閲覧履歴のいつもの並び)
                const active = key === 'unread' ? unreadOnly : key === 'visited' ? visitedOnly : key === 'viewed' ? !sort && !unreadOnly && !visitedOnly : sort?.mode === key && !unreadOnly && !visitedOnly
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => pressTab(key)}
                    // 選んでいるタブは、文字の色に加えて、強調色を薄く敷く(ひと目で分かるように)
                    className={`${TAB} ${isMobile ? 'px-2' : ''} ${active ? 'text-c-accent bg-[var(--c-accent-wash)]' : 'text-c-text-muted hover:text-c-text-body'}`}
                    title={`${def.note}${filter ? '' : '。押すたびに 逆順 → 元の並び'}(${i + 1} キー)`}
                  >
                    {props.tabLabel !== 'text' && <span className="material-symbols-outlined text-base leading-none">{def.icon}</span>}
                    {props.tabLabel !== 'icon' && <span className="truncate">{def.name}</span>}
                    {key === 'unread' && unreadTotal > 0 && (
                      <span
                        className="font-bold text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap"
                        style={{ background: 'var(--c-unread)', color: 'var(--c-unread-text)' }}
                      >
                        {/* 数が大きくなっても横に伸びないよう、999 で止める */}
                        {unreadTotal > 999 ? '+999+' : `+${unreadTotal}`}
                      </span>
                    )}
                    {!filter && (
                      <span className={`material-symbols-outlined text-sm leading-none ${active ? '' : 'invisible'}`}>
                        {key === 'viewed' ? (reversed ? 'arrow_upward' : 'arrow_downward') : active && sort?.dir === 'desc' ? 'arrow_downward' : 'arrow_upward'}
                      </span>
                    )}
                    {/* 選んでいる印の線。フッターに置くスマホは、本文の側(上)に出す */}
                    {active && <span className={`absolute ${isMobile ? 'top-0' : 'bottom-0'} left-0 right-0 h-[2px] bg-c-accent rounded-full`} />}
                  </button>
                )
              })}
            </div>
  )

  return (
    <section
      // 絞り込み・検索をしている印(スマホの戻る操作は、まずこれを外す。App の backRef)
      data-filtering={props.active !== false && (unreadOnly || visitedOnly || query || searchActive) ? 'list' : undefined}
      // 選んでいる途中の印。戻るで選ぶのをやめる(絞り込みとは別にして、メニューのジェスチャーは止めない)
      data-selecting={selected.size > 0 || undefined}
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
        className="absolute left-0 right-0 flex justify-center pointer-events-none z-[9]"
        style={{ top: headerHeight, opacity: 0, transform: `translateY(${PULL_HIDDEN_Y}px)` }}
      >
        <PullSpinner iconRef={pull.iconRef} />
      </div>
      <div
        ref={scrollRef}
        className={`flex-1 min-h-0 overflow-y-auto ${isMobile ? 'no-scrollbar' : 'custom-scrollbar thick-scrollbar'} flex flex-col`}
        onScroll={(e) => {
          pull.noteScroll()
          if (isMobile && props.hideBarsOnScroll !== false) hideBars.onScroll(e)
        }}
        onTouchStart={
          isMobile
            ? (e) => {
                hideBars.arm()
                touchPull.onTouchStart(e)
              }
            : undefined
        }
        onTouchMove={isMobile ? touchPull.onTouchMove : undefined}
        onTouchEnd={isMobile ? touchPull.onTouchEnd : undefined}
        onTouchCancel={isMobile ? touchPull.onTouchCancel : undefined}
        onWheel={(e) => {
          if (props.pullToRefresh && props.onRefresh && e.deltaY < 0 && (scrollRef.current?.scrollTop ?? 1) < 1) pull.pull(-e.deltaY)
        }}
      >
        {/* スマホ: ヘッダーはフッターと同じ色にし、下に線を引く(一覧と同じ色だと境目が分からないため) */}
        <div
          ref={headerRef}
          className={`sticky top-0 z-10 bg-panel-thread-header flex-shrink-0 ${isMobile ? 'bar-zoom bg-panel-thread-header border-b border-c-border transition-transform duration-200' : ''}`}
        >
          {/* 下の端をつかんで、板名の行の高さを変える(板名の字も合わせて大きくなる) */}
          <DragEdge
            edge="bottom"
            onMouseDown={(e) => headerDrag.startDrag(e, titleRowRef.current?.getBoundingClientRect().height ?? 44, 1)}
            onReset={headerDrag.reset}
          />
          {/* スマホ: 端のボタンが画面の縁にくっつかないよう、左右に 12px 空ける */}
          <div className={isMobile ? 'px-3 py-1' : 'p-4'}>
            {/* スマホ: 左上のメニューのボタンと板名の間を、指で押し分けやすいよう広めに */}
            <div className={`flex items-center ${isMobile ? 'gap-3' : 'gap-2'}`}>
              {/* スマホ: 左上のメニュー(サイドバーの引き出し) */}
              {isMobile && props.onOpenDrawer && (
                <button type="button" onClick={props.onOpenDrawer} className={MOBILE_HEAD_BTN} title="メニュー">
                  <span className={`material-symbols-outlined ${MOBILE_HEAD_ICON}`}>menu</span>
                </button>
              )}
              {!isMobile && <ActionButtons actions={barActions} placements={placements} where="headerStart" btnClass={LIST_BTN} iconClass="text-lg" />}
              <div
                ref={titleRowRef}
                className={`relative flex-1 min-w-0 ${isMobile ? '' : 'h-11'}`}
                // スマホは、ヘッダーの高さ(設定 --header-height。上下の余白 8px を除く)に合わせる
                style={isMobile ? { height: 'calc((var(--header-height, 72px) - 8px) / var(--bar-zoom, 1))' } : headerDrag.height ? { height: headerDrag.height } : undefined}
              >
                {/* 板名の帯全体が押せる(板名が短くても、帯のどこを押しても先頭へ) */}
                <h2
                  className={`group/title absolute inset-0 flex items-center min-w-0 font-bold text-c-text-strong ${isMobile ? 'text-base' : 'text-xl'} cursor-pointer transition-opacity duration-200 ${
                    searchActive ? 'opacity-0 pointer-events-none' : 'opacity-100'
                  }`}
                  // 引き伸ばしたら、高さに合わせて字も大きくする(既定の 44px で 1.25rem)
                  // 行の高さも字に合わせる(text-xl の決まった行の高さのままだと、大きい字の上下が切れる)
                  style={headerDrag.height ? { fontSize: `${Math.min(2.6, Math.max(0.9, (headerDrag.height / 44) * 1.25))}rem`, lineHeight: 1.45 } : undefined}
                  // スマホ: 板名を押したら、板の操作のメニュー(お気に入り・コピーなど)
                  onClick={() => (isMobile ? setTitleSheet(true) : scrollRef.current?.scrollTo({ top: 0 }))}
                  title={isMobile ? '板の操作' : 'クリックで先頭へスクロール'}
                >
                  {/* スマホはマウスを乗せる操作がない(たたくと乗せた色のまま残る)ので、色を変えない */}
                  <span className={`truncate transition-colors ${isMobile ? '' : 'group-hover/title:text-c-accent'}`}>{props.title}</span>
                </h2>
                <input
                  ref={searchRef}
                  data-search
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onBlur={() => {
                    if (!query.trim()) setSearchActive(false)
                  }}
                  onKeyDown={(e) => {
                    // Enter: 検索はそのままで欄から抜け、スレ一覧のキー操作(J・K・Enter)に戻る
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      if (!query.trim()) setSearchActive(false)
                      e.currentTarget.blur()
                      return
                    }
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
                <ActionButtons actions={barActions} placements={placements} where="header" btnClass={isMobile ? MOBILE_HEAD_BTN : LIST_BTN} iconClass={isMobile ? MOBILE_HEAD_ICON : 'text-lg'} />
                <MoreMenu actions={isMobile ? mobileMenuActions('list', barActions, placements, props.barOrder) : barActions} btnClass={isMobile ? MOBILE_HEAD_BTN : LIST_BTN} iconClass={isMobile ? MOBILE_HEAD_ICON : 'text-lg'} />
              </div>
            </div>
          </div>

          {props.subHeader}

          {selectable && selected.size > 0 && isMobile && (
            // スマホ: 選んでいる間の帯(すべて選ぶ・ログを削除・やめる)。戻るでもやめられる。
            // ヘッダーに重ねて出す(差し込むと、一覧が下にずれて、なぞっている所が分からなくなる)
            <div className="absolute inset-0 z-20 flex items-center gap-1 px-2 text-sm bg-panel-thread-header border-b border-c-border">
              <button type="button" onClick={() => setSelected(new Set())} className="p-2 rounded-xl text-c-text-muted active:bg-c-surface2" title="選ぶのをやめる">
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
              <span className="flex-1 font-bold text-c-text-strong tabular-nums">{selected.size} 件</span>
              <button
                type="button"
                onClick={() => setSelected(selected.size === visible.length ? new Set() : new Set(visible.map(threadId)))}
                className="px-3 py-1.5 rounded-xl text-c-text-body active:bg-c-surface2"
              >
                {selected.size === visible.length ? 'すべて外す' : 'すべて選ぶ'}
              </button>
              <button
                type="button"
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl font-bold text-c-heat-very-hot active:bg-c-surface2"
                onClick={() => {
                  props.onDeleteLogs!(visible.filter((t) => selected.has(threadId(t))))
                  setSelected(new Set())
                }}
              >
                <span className="material-symbols-outlined text-lg">delete</span>
                ログを削除
              </button>
            </div>
          )}
          <div className={`flex items-stretch px-4 border-b border-c-border text-sm font-medium ${isMobile || props.body ? 'hidden' : ''}`}>
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
            {/* 選んでいる間は、タブの代わりに「n 件選択中・ログを削除」(行の高さは変えない。チェックがずれないように) */}
            {!isMobile && selectable && selected.size > 0 ? (
              <div className="flex-1 flex items-center gap-3 py-1.5 text-xs">
                <span className="text-c-text-body">{selected.size} 件選択中</span>
                <button type="button" className="text-c-text-muted hover:text-c-text-strong" onClick={() => setSelected(new Set())}>
                  やめる
                </button>
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
            ) : (
              !isMobile && tabGrid
            )}
            {/* 右端: 裏で取っている印と、未読の一覧の「読んだスレを片づける」(帯を差し込むと一覧がずれるので、同じ行に) */}
            {!isMobile && (props.busyText || (unreadOnly && readInSnapshot > 0)) && (
              <div className="flex-shrink-0 flex items-center gap-3 pl-3 text-xs text-c-text-muted">
                {props.busyText && (
                  <span className="flex items-center gap-1" title={props.busyText}>
                    <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                    {props.busyText}
                  </span>
                )}
                {/* 未読の一覧は、読み終えても並びから消さない(開いただけで一覧が動かないように)。消すのは本人が押したときだけ */}
                {unreadOnly && readInSnapshot > 0 && (
                  <button type="button" onClick={() => setSweepCount((n) => n + 1)} className="hover:text-c-accent" title={`読み終えたスレ ${readInSnapshot} 件も並べています。押すと外します`}>
                    読んだ {readInSnapshot} 件を片づける
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* スマホ: フッターを一覧の上に重ねるので、最後のスレがその下に隠れないよう、下に余白を足す */}
        <div className="relative flex-1 flex flex-col" style={isMobile ? { paddingBottom: 'calc(var(--footer-bar-h, 68px) + 8px)' } : undefined}>
          {/* 取り直し・並べ直しの途中は、一覧を残したまま上に細い帯を流す(一覧を消して待たせない) */}
          {/* 帯は、取り直し(通信)のときだけ。手元の並べ替え(2ch の勢い順など)は通信しないので出さない */}
          {props.loading && visible.length > 0 && <div className="list-progress" aria-label="読み込み中" />}
          {props.body ? (
            props.body
          ) : visible.length === 0 ? (
            props.loading ? (
              <LoadingCenter />
            ) : (
              props.errorText ? (
                <LoadFailed message={props.errorText} onRetry={props.onRefresh && (() => void props.onRefresh?.())} />
              ) : (
                <div className="p-8 text-center text-c-text-muted text-sm">{props.emptyText}</div>
              )
            )
          ) : (
            <div
              // list-zoom: ︙ の「文字の大きさ」で、スレ一覧だけ大きく・小さくする
              className="list-zoom flex flex-col"
              // カード以外(行・表の見た目)は、行と行を詰めて並べる
              style={
                (props.variant ?? 'card') === 'card'
                  ? { padding: 'var(--list-padding-thread)', gap: 'var(--list-gap-thread)' }
                  : props.variant === 'discord'
                    ? { padding: isMobile ? '4px 2px' : '8px', gap: 2 }
                    : { padding: '4px 6px', gap: props.variant === 'classic' ? 0 : 1 }
              }
            >
              {pageItems ? (
                pageItems.map(renderLimited)
              ) : keywordGroups ? (
                <>
                  {keywordGroups.groups.map((g) => (
                    <div key={g.keyword} className="flex flex-col" style={{ gap: 'var(--list-gap-thread)' }}>
                      <Band icon="sell" label={g.keyword} count={g.threads.length} accent />
                      {g.threads.map(renderLimited)}
                    </div>
                  ))}
                  {keywordGroups.rest.length > 0 && <Band icon="list" label="その他のスレ" count={keywordGroups.rest.length} />}
                  {keywordGroups.rest.map(renderLimited)}
                </>
              ) : (
                visible.map(renderLimited)
              )}
              {/* まだ作っていないスレの分の高さ(スクロールバーの長さが、作り足すたびに変わらないように) */}
              {renderLimit < (pageItems ?? ordered).length && <div aria-hidden style={{ height: ((pageItems ?? ordered).length - renderLimit) * CARD_ESTIMATE, flexShrink: 0 }} />}
            </div>
          )}
          {/* ページの切り替え(件数が多いとき) */}
          {paged && (
            <div className="flex items-center justify-center gap-2 py-3 text-sm text-c-text-body">
              <button type="button" disabled={pageSafe === 0} onClick={() => goPage(pageSafe - 1)} className="p-1 rounded hover:bg-c-surface2 disabled:opacity-30" title="前のページ">
                <span className="material-symbols-outlined text-lg leading-none">chevron_left</span>
              </button>
              <span className="tabular-nums">
                {pageSafe + 1} / {pageCount}
                <span className="ml-2 text-xs text-c-text-muted">{ordered.length} スレ</span>
              </span>
              <button type="button" disabled={pageSafe >= pageCount - 1} onClick={() => goPage(pageSafe + 1)} className="p-1 rounded hover:bg-c-surface2 disabled:opacity-30" title="次のページ">
                <span className="material-symbols-outlined text-lg leading-none">chevron_right</span>
              </button>
            </div>
          )}
        </div>
      </div>
      {/* フッター。ボタンの配置で「フッター」にした操作だけ並べる(なければ出さない) */}
      {peek && <PeekPopup thread={peek} onOpen={() => onOpenCard(peek)} onClose={() => setPeek(undefined)} />}
      {note && (
        <div className="absolute left-1/2 bottom-4 -translate-x-1/2 z-30 max-w-[90%] px-3 py-2 text-xs rounded-lg bg-c-surface border border-c-border shadow-lg text-c-text-body rise-in">
          {note}
        </div>
      )}
      {(hasFooter || isMobile) && (
        <div
          ref={footerRef}
          className={`${
            // スマホ: 一覧の上に重ね、下へスクロールすると隠す
            isMobile ? 'bar-zoom absolute bottom-0 inset-x-0 z-20 pl-1 pr-3 bg-panel-thread-header transition-transform duration-200' : 'relative flex-shrink-0 h-10 px-3'
          } flex items-center justify-end gap-1 border-t border-c-border`}
          // スマホの高さは設定(--footer-bar-h)で変えられる
          style={isMobile ? { height: 'calc(var(--footer-bar-h, 68px) / var(--bar-zoom, 1))' } : footerDrag.height ? { height: footerDrag.height } : undefined}
        >
          {/* 上の端をつかんで、フッターの高さを変える */}
          <DragEdge
            edge="top"
            onMouseDown={(e) => footerDrag.startDrag(e, footerRef.current?.getBoundingClientRect().height ?? 40, -1)}
            onReset={footerDrag.reset}
          />
          {/* スマホ: 右下の丸いスレ立てボタン。フッターの上に浮かせ、フッターと一緒に隠れる */}
          {isMobile && props.onNewThread && (
            <button
              type="button"
              onClick={props.onNewThread}
              className="absolute right-4 bottom-full mb-3 w-14 h-14 rounded-full shadow-lg flex items-center justify-center"
              style={{ background: 'var(--c-accent)', color: 'var(--c-accent-text)' }}
              title="スレを立てる"
            >
              <span className="material-symbols-outlined text-2xl">edit_square</span>
            </button>
          )}
          {/* スマホ: 未読・勢い順などのタブを、フッターの左に */}
          {isMobile && <div className="flex-1 min-w-0 flex self-stretch text-[13px] font-medium">{tabGrid}</div>}
          {!isMobile && (
            <>
              <ActionButtons actions={barActions} placements={placements} where="footerStart" btnClass={LIST_BTN} iconClass="text-lg" />
              <span className="flex-1" />
            </>
          )}
          <ActionButtons
            actions={barActions}
            placements={placements}
            where="footer"
            btnClass={isMobile ? 'p-2 rounded-xl text-c-text-muted active:bg-c-surface2 transition-colors disabled:opacity-40' : LIST_BTN}
            iconClass={isMobile ? 'text-2xl' : 'text-lg'}
          />
        </div>
      )}
      {fontDialog && (
        <SliderDialog title="文字の大きさ・余白" onClose={() => setFontDialog(false)}>
          {props.fontSize}
        </SliderDialog>
      )}
      {titleSheet && (
        <ActionSheet
          title={props.boardUrl ? `${props.title}\n${props.boardUrl}` : props.title}
          onClose={() => setTitleSheet(false)}
          items={[
            ...(props.favorite
              ? [{ label: props.favorite.active ? 'お気に入り板から外す' : 'お気に入り板に足す', icon: 'star', onClick: props.favorite.onToggle }]
              : []),
            ...(props.onNewThread ? [{ label: 'スレを立てる', icon: 'edit_square', onClick: props.onNewThread }] : []),
            ...(props.boardUrl
              ? [
                  { label: '板名をコピー', icon: 'content_copy', onClick: () => copyText(props.title, '板名をコピーしました') },
                  { label: '板の URL をコピー', icon: 'link', onClick: () => copyText(props.boardUrl!, 'URL をコピーしました') },
                ]
              : []),
            { label: '先頭へ', icon: 'vertical_align_top', onClick: () => scrollRef.current?.scrollTo({ top: 0 }) },
            ...(props.onRefresh ? [{ label: '更新', icon: 'refresh', onClick: () => void props.onRefresh?.() }] : []),
            ...(props.boardUrl && props.onOpenExternal ? [{ label: 'ブラウザで開く', icon: 'open_in_new', onClick: () => props.onOpenExternal!(props.boardUrl!) }] : []),
          ] satisfies SheetItem[]}
        />
      )}
    </section>
  )
}

/** 要素の縦の位置(画面の座標) */
function spanOf(el: HTMLElement): Span {
  const r = el.getBoundingClientRect()
  return { top: r.top, bottom: r.bottom }
}

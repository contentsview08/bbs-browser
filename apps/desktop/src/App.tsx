// 画面全体: サイドバー(板一覧)/ スレ一覧パネル / タブとスレ表示 の 3 カラム。
// データの流れはここに集め、見た目は components/ の各部品(web 版から移植)に任せる。
// ログは SQLite(LogStore)に保存し、開いたスレは手元のログを先に出してから差分を取りに行く。

import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { onBackButtonPress } from '@tauri-apps/api/app'
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import {
  allConnectors,
  demoConnector,
  registerConnector,
  findConnector,
  type Board,
  type BoardInfo,
  type NewThreadInput,
  type Post,
  type PostConfirm,
  type PostInput,
  type PostResult,
  type SiteConfig,
  type ThreadSummary,
  type ListSort,
  type PostActionDef,
} from '@bbs-browser/connectors'
import {
  applyFetch,
  type FavoriteThreadEntry,
  type HistoryEntry,
  type LogStore,
  type PostHistoryEntry,
  type ThreadLog,
  type ThreadState,
  type TrollMarkRecord,
  type UploadRecord,
} from '@bbs-browser/logstore'
import type { SettingsTab } from './components/SettingsDialog'
import AddressBar from './components/AddressBar'
import Notifications from './components/Notifications'
import { anchorTargets, isAppThreadUrl, makeAnchorResolver } from './utils/postBody'
import NgRuleDialog, { type NgDraft } from './components/NgRuleDialog'
import Sidebar from './components/Sidebar'
import StyleMenu, { OPEN_FONT_DIALOG, StyleMenuItems } from './components/StyleMenu'
import FontSizeSlider, { BarSliders, SliderDialog, cssPx, setCssVar } from './components/FontSizeSlider'
import { resolvePlacements } from './utils/toolbar'
import TabBar from './components/TabBar'
import ThreadListPanel, { threadId, type SortMode } from './components/ThreadListPanel'
import TabPane, { type Tab, type TabEvents } from './components/TabPane'
import type { ScrollPosition } from './components/ThreadView'
import { openLogStore } from './host/logStore'
import { tauriContext as ctx } from './host/tauriContext'
import { lazyComponent } from './utils/lazyComponent'
import { isMobile } from './utils/platform'
import { useSwipeGesture, type SwipeMap } from './hooks/useSwipeGesture'
import UrlPrompt from './components/UrlPrompt'
import { gestureActionName } from './utils/gestures'
import { connectorsDir, loadExternalConnectors, type ExternalConnectorInfo } from './host/externalConnectors'
import { PICKABLE_SCHEMES, FONT_PX_KEY, FONT_PX_MAX, FONT_PX_MIN, POST_STYLES, effectivePostStyle, baseVariant, baseFontPx, pickSchemeNow, useSettings, type AppSettings, type ReplyLayout, type SavedTab, type UpdateSetting } from './ui/settings'
import type { PaletteItem } from './components/CommandPalette'
import { useNarrow } from './hooks/useNarrow'
import { useEvent } from './hooks/useEvent'
import { useViewState } from './hooks/useViewState'
import { canBack, canForward, forget, nextAfterClose, selectQuietly, showList, showThread, step } from './utils/viewState'
import { useAccounts } from './hooks/useAccounts'
import { useNotifications } from './hooks/useNotifications'
import { ensureNotifyPermission, sendOsNotification } from './utils/osNotify'
import { useWatchLists } from './hooks/useWatchLists'
import { useKeywordWatch } from './hooks/useKeywordWatch'
import { backgroundImageUrl } from './host/backgroundImage'
import { initFavicons } from './host/favicon'
import { initOgp } from './host/ogp'
import { KEY_ACTIONS, modalOpen, actionFor, isReloadKey, keyEventsOf, keyString, resolveKeymap, type KeyAction } from './utils/keymap'
import ConfirmDialog from './components/ConfirmDialog'
import { findNextThreads, nextUnreadThread } from './utils/nextThread'
import { favIncreases } from './utils/watch'
import { LIST_REFRESH_COOLDOWN_MS, REFRESH_COOLDOWN_MS } from './utils/cooldown'
import { isAppVisible } from './utils/visibility'
import { backgroundError } from './utils/backgroundError'
import { backupDatabase, restoreDatabase } from './host/backup'
import { deleteFromCatbox } from './host/uploader'
import { EMPTY_MARKS, bodyKey, type TrollMarks } from './utils/autoNg'
import { useTrollModel } from './hooks/useTrollModel'
import { postMatcher, pruneExpired, threadMatcher, type NgRule, type NgTarget } from './utils/ng'

/** 閉じたタブを覚えておく数(Shift+X で開き直す) */
const CLOSED_TABS_MAX = 20

/** 戻る・進むで行き来する場所 */
type ListTarget = { kind: 'board'; board: Board } | { kind: 'history' } | { kind: 'fav' }
type NavValue = { type: 'list'; list: ListTarget } | { type: 'thread'; thread: ThreadSummary }
const listEntry = (list: ListTarget) => ({
  key: list.kind === 'board' ? `board:${list.board.url}` : list.kind,
  value: { type: 'list', list } as NavValue,
})
const threadEntry = (thread: ThreadSummary) => ({ key: `thread:${threadId(thread)}`, value: { type: 'thread', thread } as NavValue })

/** タブを押し続けて切り替えたとき、連打がこれだけ止まったら、選んでいたタブに切り替える */
const TAB_REPEAT_SETTLE_MS = 200
/** スマホ: スレ表示がすべり込む・すべって出ていく時間(下の duration-[250ms] と同じ) */
const SLIDE_MS = 250
/** スマホ: 引き出し(サイドバー)の中身の拡大率。PC 向けの小さな字のままだと、ほかの画面より小さく見える */
const DRAWER_ZOOM = 1.15

// 開発中のアプリだけ、お試しの掲示板(通信しない。https://demo.bbs-browser.invalid/board/)を足す
if (import.meta.env.DEV) registerConnector(demoConnector)

/** アプリの中でウェブページを読むときの名乗り(スマホなら Android の Chrome、PC なら Windows の Chrome) */
const BROWSER_UA = isMobile
  ? 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
  : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

// たまにしか開かない画面は、開いたときに読み込む(起動を軽くするため)
const SettingsDialog = lazyComponent(() => import('./components/SettingsDialog'))
const NewThreadDialog = lazyComponent(() => import('./components/NewThreadDialog'))
const MobileSettings = lazyComponent(() => import('./components/mobile/MobileSettings'))
const UploadHistoryDialog = lazyComponent(() => import('./components/UploadHistoryDialog'))
const PostHistoryDialog = lazyComponent(() => import('./components/PostHistoryDialog'))
const ReaderView = lazyComponent(() => import('./components/ReaderView'))
const CommandPalette = lazyComponent(() => import('./components/CommandPalette'))
const KeyHelp = lazyComponent(() => import('./components/KeyHelp'))

const connectorOf = (id: string) => {
  const c = findConnector(id)
  if (!c) throw new Error(`コネクタ ${id} がありません`)
  return c
}

/** レスの数の上限まで来たスレか(2ch・したらばは 1000。上限のない掲示板はいつも false) */
const isFull = (t: ThreadSummary, posts: Post[]) => {
  const max = findConnector(t.connectorId)?.maxPosts
  return max !== undefined && posts.length >= max
}

/** URL を扱えるコネクタで、板(とスレ)に読み替える */
/**
 * URL から板(とスレ)を割り出す。開けないときは、理由を付けて投げる(右下にエラーとして出る)。
 * - どのコネクタも扱わない URL: 対応していない URL
 * - 形は合うが、板が見つからない・掲示板の板ではない: コネクタが調べた理由
 */
async function resolve(url: string) {
  const trimmed = url.trim()
  try {
    new URL(trimmed)
  } catch {
    throw new Error(`URL として読めません: ${trimmed}`)
  }
  const connector = allConnectors().find((c) => c.canHandle(trimmed))
  if (!connector) throw new Error(`対応していない URL です: ${trimmed}`)
  let r: Awaited<ReturnType<typeof connector.resolveUrl>>
  try {
    r = await connector.resolveUrl(trimmed, ctx)
  } catch (e) {
    throw new Error(`開けない URL です: ${trimmed}\n${e instanceof Error ? e.message : String(e)}`)
  }
  if (!r) throw new Error(`開けない URL です: ${trimmed}\n板やスレの URL の形ではありません`)
  return r
}

type Loading = 'threads' | 'posts'

/** スレ表示を残しておくタブの数(切り替えを軽くするため。多すぎると覚えておくぶん重くなる) */
const KEEP_TABS = 5

function newTab(thread: ThreadSummary): Tab {
  return { id: threadId(thread), thread, unreadFrom: 1, readNo: 0, ownNos: new Set(), loading: false }
}

/** ログを読み終えるまでの、空のログ(スレごとに 1 つ作って使い回す。毎回作ると表示を作り直してしまう) */
const placeholders = new Map<string, ThreadLog>()
function placeholderLog(thread: ThreadSummary): ThreadLog {
  const id = threadId(thread)
  let log = placeholders.get(id)
  if (!log) {
    if (placeholders.size > 50) placeholders.clear()
    log = { title: thread.title, posts: [], cursor: null, postCount: 0, readNo: 0, status: 'active' }
    placeholders.set(id, log)
  }
  return log
}

function fromSaved(s: SavedTab): ThreadSummary {
  return { ...s, order: 0, createdAt: s.createdAt === undefined ? undefined : new Date(s.createdAt) }
}

export default function App() {
  const [store, setStore] = useState<LogStore>()
  const [settings, updateSetting, settingsLoaded] = useSettings(store)
  // 非同期の処理(取得の後始末など)から、いまの設定を見るための控え
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const [sites, setSites] = useState<SiteConfig[]>([])
  const [favorites, setFavorites] = useState<Board[]>()
  const [board, setBoard] = useState<Board>()
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [states, setStates] = useState(new Map<string, ThreadState>())
  const [history, setHistory] = useState<HistoryEntry[]>()
  const [tabs, setTabs] = useState<Tab[]>([])
  /** Ctrl/Shift+クリックで選んだタブ */
  const [selectedTabs, setSelectedTabs] = useState<Set<string>>(new Set())
  const [refreshingAll, setRefreshingAll] = useState(false)
  /** 閲覧履歴を取り直した回数(「未読」で絞り込んだ顔ぶれを控え直すきっかけ) */
  const [historyVersion, setHistoryVersion] = useState(0)
  /** 板ごとの設定(名無しの名前など)。板ごとに一度だけ取る */
  const [boardInfos, setBoardInfos] = useState(new Map<string, BoardInfo>())
  const boardInfoAsked = useRef(new Set<string>())
  const [loading, setLoading] = useState(new Set<Loading>())
  const [error, setError] = useState<string>()
  /** 開いている設定画面の分類。undefined なら閉じている */
  const [settingsTab, setSettingsTab] = useState<SettingsTab>()
  const [newThreadOpen, setNewThreadOpen] = useState(false)
  /** サイドバーに出す直近の閲覧履歴 */
  const [recentHistory, setRecentHistory] = useState<ThreadSummary[]>([])
  const reloadRecent = async (s: LogStore) => setRecentHistory((await s.history(10)).map((h) => h.thread))
  /** 画像のアップロード履歴(開いているときだけ中身を持つ) */
  const [uploads, setUploads] = useState<UploadRecord[]>()
  const [hasUploads, setHasUploads] = useState(false)
  const openUploads = () =>
    run(null, async () => {
      if (store) setUploads(await store.listUploads())
    })
  // アカウント(5ch の BE など)
  const { accounts, loginStatus, loadAndAutoLogin, saveAndLogin, deleteAccount, postAccountsOf, postAccountIds } = useAccounts(
    store,
    settings.postAccounts,
  )

  /** 書き込み履歴(開いているときだけ中身を持つ) */
  const [postHistory, setPostHistory] = useState<PostHistoryEntry[]>()
  const openPostHistory = () =>
    run(null, async () => {
      if (store) setPostHistory(await store.listPostHistory())
    })
  /** アプリ内の通知(右下)。裏の処理の失敗もここに出る */
  const { notifications, notify: notifyInApp, dismiss } = useNotifications()
  /**
   * 知らせる。いつもアプリの中(右下)に出し、スマホでアプリを裏に回しているときは OS の通知でも出す
   * (失敗の知らせは、アプリを見ているときに分かればよいので OS には出さない)
   */
  const notify = useCallback(
    (n: Parameters<typeof notifyInApp>[0]) => {
      notifyInApp(n)
      if (isMobile && settingsRef.current.osNotify && n.icon !== 'error' && document.visibilityState === 'hidden')
        void sendOsNotification(n.title, n.body).catch(() => undefined)
    },
    [notifyInApp],
  )
  // スマホ: OS の通知をオンにしていれば、起動したときに一度だけ許可を求める(もう許可していれば聞かない)
  useEffect(() => {
    if (isMobile && settingsLoaded && settingsRef.current.osNotify) void ensureNotifyPermission().catch(() => undefined)
  }, [settingsLoaded])
  /** 通知から、そのタブのそのレスへ飛ぶ */
  const [jump, setJump] = useState<{ tabId: string; no: number; seq: number }>()
  /** NG を登録する画面(元の文字を入れて開く) */
  const [ngDraft, setNgDraft] = useState<NgDraft>()
  /** 表示スタイルのメニューから開く、画面全体の文字サイズの画面 */
  const [baseFontDialog, setBaseFontDialog] = useState(false)
  useEffect(() => {
    const open = () => setBaseFontDialog(true)
    window.addEventListener(OPEN_FONT_DIALOG, open)
    return () => window.removeEventListener(OPEN_FONT_DIALOG, open)
  }, [])
  /** キー操作の一覧(? キー) */
  const [keyHelpOpen, setKeyHelpOpen] = useState(false)
  /** コマンドパレット(Ctrl+K・:) */
  const [paletteOpen, setPaletteOpen] = useState(false)
  /** 消そうとしている自分の書き込み(確かめるダイアログを出している間) */
  const [postDeleteConfirm, setPostDeleteConfirm] = useState<{ t: ThreadSummary; p: Post }>()
  /** 確かめてから実行するレスへの操作(通報など。コネクタの postActions の confirm) */
  const [postActionConfirm, setPostActionConfirm] = useState<{ t: ThreadSummary; p: Post; def: PostActionDef }>()
  /** レスへの操作を実行して、結果を知らせる */
  const runPostAction = (t: ThreadSummary, p: Post, def: PostActionDef) => {
    const c = findConnector(t.connectorId)
    if (!c?.runPostAction) return
    void c.runPostAction(t, p, def.id, ctx).then(
      (r) => notify(r.status === 'ok' ? { icon: def.icon, title: r.message || `${def.label}しました` } : { icon: 'error', title: `${def.label}できませんでした`, body: r.message }),
      backgroundError(def.label),
    )
  }
  /** Shift+Delete で消そうとしているタブ(確かめるダイアログを出している間) */
  const [deleteConfirm, setDeleteConfirm] = useState<string[]>()
  // 縦長のときは、スレ一覧をしまってスレ表示だけにする。スレ一覧は左から引き出す
  const narrow = useNarrow()
  /** 1 画面(スレ一覧とスレ表示のどちらか一方だけを出す)か。設定と、ウィンドウの形で決まる */
  const single = isMobile || settings.paneMode === 'single' || (settings.paneMode === 'auto' && narrow)
  /** スマホ: サイドバーの引き出しを開いているか(左上のメニュー・左の端からのスワイプで開き、何か開いたら閉じる) */
  const [drawerOpen, setDrawerOpen] = useState(false)
  /** アプリの中で開いているリンク(リーダー表示) */
  const [readerUrl, setReaderUrl] = useState<string>()
  /** スマホ: URL を入れて開く小さな画面(URL 欄の帯の代わり)。開いている間は入れている文字 */
  const [urlPrompt, setUrlPrompt] = useState<string>()
  /** キー操作の割り当て(スレ表示とスレ一覧で同じものを使う) */
  const keymap = useMemo(() => resolveKeymap(settings.keymap), [settings.keymap])
  // ── 画面の状態 ──
  // 選んでいるタブ・1 画面でスレ一覧を出しているか・戻る/進むの履歴。3 つは utils/viewState.ts の関数でいっしょに変える
  const { view, update: updateView } = useViewState<NavValue>()
  const { activeId, listOpen } = view.current

  // 見たもの(スレ一覧・スレ)を見た順に覚え、上の帯の ← →・マウスの戻る/進むボタン・Alt+← → で行き来する
  const goNav = (d: -1 | 1) => {
    // スレ表示から離れる前に、見えている所までの既読をすぐ知らせる(既読はスクロールが止まって少ししてから知らせるので、
    // 開いてすぐ戻ると、見えた新着が既読にならず、スレ一覧に新着の印が残っていた)
    readFlush.current?.()
    const r = step(view.current, d)
    if (!r) return
    updateView(() => r.state)
    applyNav(r.entry.value)
  }
  /** 覚えておいた場所を見せる(戻る・進むのとき。履歴には積まない) */
  const applyNav = (v: NavValue) => {
    if (v.type === 'thread') {
      const open = tabsRef.current.find((t) => t.id === threadId(v.thread))
      if (open) selectTab(open.id, false)
      else void openThread(v.thread, { record: false }) // 閉じたタブのスレは開き直す
      return
    }
    const cur = currentListTarget()
    const same =
      cur?.kind === v.list.kind && (v.list.kind !== 'board' || (cur.kind === 'board' && cur.board.url === v.list.board.url))
    if (same) updateView((s) => showList(s, undefined))
    else if (v.list.kind === 'board') void openBoard(v.list.board, false)
    else if (v.list.kind === 'history') void openHistory(false)
    else void openFavThreads(false)
  }
  /** いま出しているスレ一覧へ戻る(1 画面のとき。スレタイの左の ← や、削除したあと) */
  const returnToList = () => {
    readFlush.current?.()
    const cur = currentListTarget()
    updateView((s) => showList(s, cur && listEntry(cur)))
  }
  /** 1 画面のとき、スレ表示を(スレ一覧の上に)出しているか。開いているスレがあって、一覧に戻っていないとき */
  const threadShown = (activeId !== undefined) && !listOpen
  /**
   * 2 画面のとき、キー操作(F5・Ctrl+R、PageUp・PageDown・Home・End など)をスレ一覧とスレ表示のどちらが受け取るか。
   * 押した(触った)方に移り、スレを開けばスレ表示、板などを開けばスレ一覧に移る。1 画面では見えている方
   */
  const [focusPane, setFocusPane] = useState<'list' | 'thread'>('thread')
  const listFocused = single ? !threadShown : focusPane === 'list' || activeId === undefined

  // 非同期の処理の途中で最新の値を見るための控え
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeTab = tabs.find((t) => t.id === activeId)
  /** スレ一覧に見えているスレの並び(スレの最後の「次の未読スレへ」が探す順) */
  const [shownList, setShownList] = useState<ThreadSummary[]>([])
  // 一覧は描き直しのたびに作り直されるので、顔ぶれ・並び・レス数が同じなら差し替えない(描き直しが続かないように)
  const onShownChange = useCallback((list: ThreadSummary[]) => {
    setShownList((prev) =>
      prev.length === list.length && prev.every((t, i) => threadId(t) === threadId(list[i]) && t.postCount === list[i].postCount) ? prev : list,
    )
  }, [])
  const nextUnreadRef = useRef<{ thread: ThreadSummary; unread: number } | undefined>(undefined)

  const run = async (kind: Loading | null, fn: () => Promise<void>) => {
    if (kind) setLoading((s) => new Set(s).add(kind))
    setError(undefined)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (kind)
        setLoading((s) => {
          const next = new Set(s)
          next.delete(kind)
          return next
        })
    }
  }

  // 起動: DB を開いてサイト一覧とお気に入りを読む。
  // 開発中(StrictMode)は effect が 2 回走るので、1 回だけにする(DB を 2 回開き、BE に 2 回ログインしないように)
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void run(null, async () => {
      const s = await openLogStore()
      initFavicons(s)
      initOgp(s)
      void reloadRecent(s)
      void s
        .listUploads(1)
        .then((u) => setHasUploads(u.length > 0))
        .catch(backgroundError('アップロード履歴の読み込み'))
      const [list, favs, favThreadList] = await Promise.all([s.listSites(), s.listFavorites(), s.listFavoriteThreads()])
      setStore(s)
      setSites(list)
      setFavorites(favs)
      setFavThreads(favThreadList)
      void s
        .listTrollMarks()
        .then(setMarkRecords)
        .catch(backgroundError('自動 NG の印の読み込み'))
      // アカウントは裏でログインしておく(失敗したら通知だけ出し、起動は止めない)
      await loadAndAutoLogin(s, (a, r) =>
        notify({ icon: 'error', title: `${a.accountId.toUpperCase()} にログインできませんでした`, body: r.message }),
      )
    })
  }, [])

  /** BBS メニューの板一覧(設定画面の板選びで使う)。保存してあるものを返し、なければ・refresh なら取りに行く */
  const loadBoards = async (target: SiteConfig, refresh: boolean): Promise<Board[]> => {
    if (!store) return []
    if (!refresh) {
      const cached = await store.getBoards(target.menuUrl)
      if (cached.length > 0) return cached
    }
    const list = await connectorOf(target.connectorId).listBoards(target, ctx)
    await store.replaceBoards(target.menuUrl, list)
    return list
  }

  // 既読状態は「いま開いている板」のものだけを持つ。別の板のスレを読んでいても混ざらないように
  const boardRef = useRef<Board | undefined>(undefined)
  boardRef.current = board

  // 裏の処理(お気に入りのスレの確認・キーワードの見張り)が使うスレ一覧の使い回し
  const { remember: rememberList, listForWatch } = useWatchLists()
  /** いま出している板で「新」の印を付ける境目の時刻(前回その板の一覧を取った時刻)。初めての板なら undefined */
  const [newSince, setNewSince] = useState<number>()
  const lastBoardUrl = useRef(settings.lastBoardUrl)
  lastBoardUrl.current = settings.lastBoardUrl
  /**
   * いまのスレ一覧を、サーバーがどの並びで返したか(ふたばのカタログの勢順など。ふつうの掲示板はいつも undefined)。
   * スレ一覧で並びを変えたら、サーバーに並べ替えを頼める掲示板なら、その並びで取り直す
   */
  const [listOrder, setListOrder] = useState<ListSort>()
  /** 頼んでいる並び(取り直しの途中なら、まだ listOrder と違う) */
  const listOrderRef = useRef<ListSort | undefined>(undefined)
  /** スレ一覧の並びを、その掲示板のサーバーに頼める並びにする(頼めなければ undefined = 手元で並べ替える) */
  const serverSortFor = (b: Board, sort: { mode: SortMode; dir: 'desc' | 'asc' } | null): ListSort | undefined => {
    if (!sort) return undefined
    const want: ListSort =
      sort.mode === 'momentum' ? 'momentum' : sort.mode === 'newest' ? (sort.dir === 'desc' ? 'newest' : 'oldest') : sort.dir === 'desc' ? 'most' : 'fewest'
    return connectorOf(b.connectorId).serverSorts?.includes(want) ? want : undefined
  }
  const orderOf = (order: ListSort): { mode: SortMode; dir: 'desc' | 'asc' } =>
    order === 'momentum'
      ? { mode: 'momentum', dir: 'desc' }
      : order === 'newest' || order === 'oldest'
        ? { mode: 'newest', dir: order === 'newest' ? 'desc' : 'asc' }
        : { mode: 'count', dir: order === 'most' ? 'desc' : 'asc' }
  /** スレ一覧で並びを変えた。サーバーに頼める並びが変わったら、その並びで取り直す */
  const onListSort = (sort: { mode: SortMode; dir: 'desc' | 'asc' } | null) => {
    const b = boardRef.current
    if (!b) return
    const order = serverSortFor(b, sort)
    if (order === listOrderRef.current) return
    // 届くまでは、今の一覧を手元で並べ替えて見せる(listOrder は届いた一覧と一緒に変える)
    listOrderRef.current = order
    void run('threads', async () => {
      const list = await connectorOf(b.connectorId).listThreads(b, ctx, { sort: order })
      if (boardRef.current?.url !== b.url || listOrderRef.current !== order) return
      rememberList(b.url, list)
      setThreads(list)
      setListOrder(order)
    })
  }

  /** 板のスレ一覧を開く。record が false(一覧の更新・戻る/進む)なら、戻る・進むの履歴には覚えない */
  const openBoard = (b: Board, record = true) =>
    run('threads', async () => {
      if (!store) return
      // 1 画面のとき、選んだ板のスレ一覧を見せる
      updateView((s) => showList(s, record ? listEntry({ kind: 'board', board: b }) : undefined))
      if (record) setFocusPane('list')
      setBoard(b)
      // 「起動時に前回の板を開く」ために覚えておく
      if (lastBoardUrl.current !== b.url) updateSetting('lastBoardUrl', b.url)
      // 同じ板の取り直しなら、今の並びのまま、届くまで今の一覧を残す(消して待たせない。上に細い帯が流れる)。
      // 別の板なら、設定の「最初の並び順」で(サーバーに頼める掲示板だけ)
      const sameBoard = boardRef.current?.url === b.url && !favView && !history
      const order = sameBoard
        ? listOrderRef.current
        : serverSortFor(b, settingsRef.current.threadSort === 'subject' ? null : { mode: settingsRef.current.threadSort, dir: 'desc' })
      listOrderRef.current = order
      setHistory(undefined)
      setFavView(false)
      if (!sameBoard) {
        setThreads([])
        setListOrder(order)
      }
      // 前回この板の一覧を取った時刻より後に立ったスレに「新」の印を付ける。今回の時刻を次のために覚える
      setNewSince(settingsRef.current.boardVisits[b.url])
      updateSetting('boardVisits', { ...settingsRef.current.boardVisits, [b.url]: Date.now() })
      const [list, st] = await Promise.all([connectorOf(b.connectorId).listThreads(b, ctx, { sort: order }), store.getThreadStates(b.url)])
      if (listOrderRef.current !== order) return // 待っているあいだに並びを変えた(そちらの取り直しを使う)
      rememberList(b.url, list)
      setThreads(list)
      setListOrder(order)
      setStates(st)
    })

  /** 閲覧履歴の更新で、スレ一覧(subject.txt)から分かったレス数(スレの id → レス数)。ログには入れず、未読の数にだけ使う */
  const [historyCounts, setHistoryCounts] = useState(new Map<string, number>())

  /**
   * 閲覧履歴の更新。dat を 1 つずつ取りに行くとサーバーの負担が大きいので、
   * 板ごとにスレ一覧(subject.txt)を 1 回だけ取り、載っていればそのレス数を新しい数として使う。
   * 載っていないスレだけ、dat 落ちかもしれないので dat を見に行く(落ちていれば dat 落ちに、残っていれば新着を取る)
   */
  const refreshHistory = () =>
    run('threads', async () => {
      if (!store) return
      const list = await store.history()
      setHistory(list)
      const byBoard = new Map<string, HistoryEntry[]>()
      for (const h of list) byBoard.set(h.thread.boardUrl, [...(byBoard.get(h.thread.boardUrl) ?? []), h])
      const counts = new Map(historyCounts)
      for (const [boardUrl, entries] of byBoard) {
        const connectorId = entries[0].thread.connectorId
        let subject: Map<string, ThreadSummary> | undefined
        try {
          const threads = await connectorOf(connectorId).listThreads({ connectorId, url: boardUrl, name: '' }, ctx)
          subject = new Map(threads.map((t) => [t.key, t]))
        } catch {
          subject = undefined // 板ごと取れなかったら、この板は今回は見送る
        }
        if (!subject) continue
        for (const h of entries) {
          const live = subject.get(h.thread.key)
          if (live) counts.set(threadId(h.thread), live.postCount)
          else if (h.status !== 'archived') await fetchThread(store, h.thread).catch(() => undefined)
        }
        setHistoryCounts(new Map(counts))
        setHistory(await store.history())
      }
      setHistoryVersion((v) => v + 1)
      await reloadRecent(store)
    })

  const openHistory = (record = true) =>
    run('threads', async () => {
      updateView((s) => showList(s, record ? listEntry({ kind: 'history' }) : undefined))
      if (record) setFocusPane('list')
      setFavView(false)
      if (store) setHistory(await store.history())
      setHistoryVersion((v) => v + 1)
    })

  /** いまスレ一覧に出しているもの(戻る・進むで覚える) */
  const currentListTarget = (): ListTarget | undefined =>
    favView ? { kind: 'fav' } : history ? { kind: 'history' } : board ? { kind: 'board', board } : undefined

  // ── お気に入りのスレ ──

  /** お気に入りのスレ。サイドバーの新着の数と ☆ の印に使うので、いつも読み込んでおく */
  const [favThreads, setFavThreads] = useState<FavoriteThreadEntry[]>([])
  /** スレ一覧に、お気に入りのスレを出しているか */
  const [favView, setFavView] = useState(false)
  /** スレ一覧(subject.txt)から分かったレス数(スレの id → レス数)。ログには入れず、未読の数にだけ使う */
  const [favCounts, setFavCounts] = useState(new Map<string, number>())
  /** 自動 NG にユーザーが付けた印。起動時に DB から読む */
  const [markRecords, setMarkRecords] = useState<TrollMarkRecord[]>([])
  const trollMarks = useMemo<TrollMarks>(
    () =>
      markRecords.length === 0
        ? EMPTY_MARKS
        : {
            troll: new Set(markRecords.filter((m) => m.troll).map((m) => m.bodyKey)),
            notTroll: new Set(markRecords.filter((m) => !m.troll).map((m) => m.bodyKey)),
          },
    [markRecords],
  )
  /** 印を付ける・外す。画面にはすぐ出し、DB には裏で書く */
  const markTroll = (t: ThreadSummary, p: Post, troll: boolean | null, reason?: string) => {
    const key = bodyKey(p.body)
    const record: TrollMarkRecord | undefined =
      troll === null ? undefined : { bodyKey: key, troll, body: p.body, boardUrl: t.boardUrl, reason, createdAt: Date.now() }
    setMarkRecords((list) => [...list.filter((m) => m.bodyKey !== key), ...(record ? [record] : [])])
    if (!store) return
    void (record ? store.setTrollMark(record) : store.removeTrollMark(key)).catch(backgroundError('自動 NG の印の保存'))
  }
  // 印から育つ判定(utils/trollModel.ts)。ログの数え上げと学習は画面の外(workers/trollWorker.ts)で行う
  const trollJudge = useTrollModel(store, settings.autoNg, markRecords)
  /** スレ一覧を取ったときに分かった、スレごとのレス数(板を移っても残す)。開いているタブの未読の数に使う */
  const [listCounts, setListCounts] = useState(new Map<string, number>())
  useEffect(() => {
    if (threads.length === 0) return
    setListCounts((m) => {
      const next = new Map(m)
      for (const t of threads) next.set(threadId(t), t.postCount)
      return next
    })
  }, [threads])
  /** 一覧・お気に入りスレ・履歴の取り直しで分かったレス数のうち、一番新しいもの(多いもの) */
  const knownCount = (id: string) => Math.max(listCounts.get(id) ?? 0, favCounts.get(id) ?? 0, historyCounts.get(id) ?? 0)
  const favCountsRef = useRef(favCounts)
  favCountsRef.current = favCounts
  const [favVersion, setFavVersion] = useState(0)
  const favIds = useMemo(() => new Set(favThreads.map((f) => threadId(f.thread))), [favThreads])
  const reloadFavThreads = async (s: LogStore) => setFavThreads(await s.listFavoriteThreads())
  /** 手元の既読・レス数が変わったら、お気に入りの行にも写す(未読の数がずれないように) */
  const patchFav = (t: ThreadSummary, patch: (f: FavoriteThreadEntry) => FavoriteThreadEntry) => {
    const id = threadId(t)
    setFavThreads((list) => (list.some((f) => threadId(f.thread) === id) ? list.map((f) => (threadId(f.thread) === id ? patch(f) : f)) : list))
  }

  const toggleFavoriteThread = (t: ThreadSummary) => {
    if (!store) return
    const on = favIds.has(threadId(t))
    void run(null, async () => {
      await (on ? store.removeFavoriteThread(t) : store.addFavoriteThread(t))
      await reloadFavThreads(store)
    })
  }

  /**
   * お気に入りのスレの新着を確かめる。閲覧履歴と同じく、板ごとにスレ一覧(subject.txt)を 1 回だけ取り、
   * 載っていればそのレス数を新しい数にする(本文は取りに行かないので軽い)。
   * fetchDats(まとめて更新)のときは、新着のあるスレと、一覧に載っていない(dat 落ちかもしれない)スレの本文も取る
   */
  const checkFavThreads = async (s: LogStore, fetchDats: boolean) => {
    const list = await s.listFavoriteThreads()
    const before = new Map(favCountsRef.current)
    const byBoard = new Map<string, FavoriteThreadEntry[]>()
    for (const f of list) byBoard.set(f.thread.boardUrl, [...(byBoard.get(f.thread.boardUrl) ?? []), f])
    const counts = new Map(favCountsRef.current)
    for (const [boardUrl, entries] of byBoard) {
      const connectorId = entries[0].thread.connectorId
      let subject: Map<string, ThreadSummary>
      try {
        // 裏で確かめるときは、少し前に取った一覧を使い回す(まとめて更新は取り直す)
        const b = { connectorId, url: boardUrl, name: '' }
        const threads = fetchDats ? await connectorOf(connectorId).listThreads(b, ctx) : await listForWatch(b)
        if (fetchDats) rememberList(boardUrl, threads)
        subject = new Map(threads.map((t) => [t.key, t]))
      } catch {
        continue // 板ごと取れなかったら、この板は今回は見送る
      }
      for (const f of entries) {
        const live = subject.get(f.thread.key)
        if (live) counts.set(threadId(f.thread), live.postCount)
        if (!fetchDats || f.status === 'archived') continue
        if (!live || live.postCount > f.postCount) await fetchThread(s, f.thread).catch(() => undefined)
      }
      setFavCounts(new Map(counts))
    }
    await reloadFavThreads(s)
    // 裏で確かめたときだけ、新着を知らせる(まとめて更新は、本人が一覧を見ているので知らせない)
    if (!fetchDats && settingsRef.current.notifyFavThreads) {
      const byId = new Map(list.map((f) => [threadId(f.thread), f]))
      const added = favIncreases(
        list.filter((f) => f.postCount > 0).map((f) => ({ id: threadId(f.thread), title: f.thread.title, readNo: f.readNo, localCount: f.postCount })),
        before,
        counts,
      )
      if (added.length === 1) {
        const f = byId.get(added[0].id)!
        notify({ icon: 'bookmark', title: `お気に入りのスレに新着 +${added[0].added}`, body: f.thread.title, onClick: () => latest.current.openThread(f.thread) })
      } else if (added.length > 1) {
        notify({
          icon: 'bookmark',
          title: `お気に入りのスレ ${added.length} 件に新着`,
          body: added
            .slice(0, 3)
            .map((a) => `+${a.added} ${a.title}`)
            .join('\n') + (added.length > 3 ? `\n(ほか ${added.length - 3} 件)` : ''),
          onClick: () => latest.current.openFavThreads(),
        })
      }
    }
  }

  /**
   * 定期的な見張りと、あとで押される通知から呼ぶ関数は、いつもいまのものを使う
   * (見張りを始めたときの関数を持ち続けると、そのころの状態(開いていたタブなど)で動いてしまうため)
   */
  const latest = useRef({
    openThread: (t: ThreadSummary) => void openThread(t),
    openFavThreads: () => void openFavThreads(),
    checkFavThreads,
  })
  latest.current = {
    openThread: (t: ThreadSummary) => void openThread(t),
    openFavThreads: () => void openFavThreads(),
    checkFavThreads,
  }

  /** まとめて更新(スレ一覧の更新ボタン・引っぱって更新) */
  const refreshFavThreads = () =>
    run('threads', async () => {
      if (!store) return
      await checkFavThreads(store, true)
      setFavVersion((v) => v + 1)
    })

  const openFavThreads = (record = true) =>
    run('threads', async () => {
      updateView((s) => showList(s, record ? listEntry({ kind: 'fav' }) : undefined))
      if (record) setFocusPane('list')
      setHistory(undefined)
      setFavView(true)
      if (store) await reloadFavThreads(store)
      setFavVersion((v) => v + 1)
    })

  // 数分おきに、お気に入りのスレの新着の数だけを確かめる(起動してしばらくしたら一度)
  const hasFavThreads = favThreads.length > 0
  useEffect(() => {
    if (!store || settings.favCheckMin <= 0 || !hasFavThreads) return
    // アプリが見えていないあいだは確かめない
    const check = () => {
      if (isAppVisible()) void latest.current.checkFavThreads(store, false).catch(() => undefined)
    }
    const first = setTimeout(check, 5000)
    const timer = setInterval(check, settings.favCheckMin * 60_000)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [store, settings.favCheckMin, hasFavThreads])

  // ── タブ ──

  const patchTab = (id: string, patch: Partial<Tab>) =>
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  /**
   * スレを取りに行って保存し、そのタブの表示を差し替える。
   * 同じスレを取りに行っている最中なら、それを待つ。force なら、待ったあとでもう一度取りに行く
   * (書き込んだ直後は、自分のレスが入った状態を必ず取りたいので)
   */
  const inflight = useRef(new Map<string, Promise<void>>())
  /** ログを削除したスレ。削除の前に始まった取得・既読の記録が、あとから一覧の印を書き戻さないように覚えておく(開き直したら外す) */
  const deletedIds = useRef(new Set<string>())
  const fetchThread = async (
    s: LogStore,
    t: ThreadSummary,
    // keepUnread: 「ここから未読」を動かさない(開いたときの取得。線は更新したときだけ引き直す)
    opts: { force?: boolean; keepUnread?: boolean } = {},
  ) => {
    const id = threadId(t)
    const running = inflight.current.get(id)
    if (running) {
      await running
      if (!opts.force) return
    }
    const job = (async () => {
      patchTab(id, { loading: true })
      try {
        // 手元のログ(タブで開いていればそれ、なければ DB)に、取ってきた差分を当てはめる。
        // 取得のたびにスレ全体を DB から読み直さないため(1000 レスのスレほど効く)
        const inTab = tabsRef.current.find((x) => x.id === id)?.log
        const before = inTab && inTab.cursor !== null ? inTab : await s.loadThread(t)
        const r = await connectorOf(t.connectorId).fetchPosts(t, before?.cursor ?? null, ctx)
        await s.saveFetch(t, r)
        const saved = applyFetch(before, t, r)
        const changed = saved !== before
        // 「ここから未読」は、更新したときにその時点の既読位置の次へ引き直す
        // (開いた時点の位置のままにすると、読み終えて更新しても線が残り続ける)。
        // 開いたときの取得では動かさない(開いた直後に画面に見えたレスが既読になり、線が下へずれてしまうため)。
        // 変わらなかったときはログを差し替えない(スレ表示を描き直さない)
        // レスへの反応(ふたばのそうだねなど)は、新しいレスがなくても増えるので、届いたら写す
        const reactions = r.reactions && new Map(Object.entries(r.reactions).map(([k, v]) => [Number(k), v] as const))
        setTabs((ts) =>
          ts.map((x) => {
            if (x.id !== id) return x
            const unreadFrom = opts.keepUnread ? x.unreadFrom : x.readNo + 1
            if (!changed && x.log && unreadFrom === x.unreadFrom && !reactions) return x
            return {
              ...x,
              log: changed || !x.log ? saved : x.log,
              unreadFrom,
              ...(reactions && { reactions: new Map([...(x.reactions ?? []), ...reactions]) }),
            }
          }),
        )
        // 自分宛てのレスが新しく届いたら知らせる(初めて開いたスレの、もとからあるレスでは知らせない)
        if (changed && before && settingsRef.current.notifyReplies) await notifyReplies(s, t, saved, before.postCount)
        if (changed) {
          patchFav(t, (f) => ({ ...f, postCount: saved.postCount, status: saved.status, thread: { ...f.thread, postCount: saved.postCount } }))
          // 閲覧履歴の一覧の行も、取ってきたレス数と dat 落ちを写す
          setHistory((list) =>
            list?.map((h) =>
              threadId(h.thread) === id ? { ...h, postCount: saved.postCount, status: saved.status, thread: { ...h.thread, postCount: saved.postCount } } : h,
            ),
          )
        }
        // スレ一覧の印(レス数・dat 落ち)は、このスレの 1 行だけ書き換える(板全体を読み直さない)。
        // 取っている間にログを削除したスレは書き戻さない(一覧で「見たスレ」に戻ってしまう)
        if (changed && boardRef.current?.url === t.boardUrl && !deletedIds.current.has(id))
          setStates((m) => {
            const cur = m.get(t.key)
            return new Map(m).set(t.key, { postCount: saved.postCount, readNo: cur?.readNo ?? saved.readNo, status: saved.status })
          })
      } finally {
        patchTab(id, { loading: false })
      }
    })()
    inflight.current.set(id, job)
    try {
      await job
    } finally {
      if (inflight.current.get(id) === job) inflight.current.delete(id)
    }
  }

  /** 新着の中に、自分の書き込みへのアンカーがあれば通知する。たくさんあるときは 3 件までにしてまとめる */
  const notifyReplies = async (s: LogStore, t: ThreadSummary, log: ThreadLog, beforeCount: number) => {
    const own = new Set(await s.getOwnPosts(t))
    if (own.size === 0) return
    const resolve = makeAnchorResolver(log.posts, findConnector(t.connectorId)?.anchorTarget)
    const replies = log.posts.filter((p) => p.no > beforeCount && !own.has(p.no) && anchorTargets(p.body, resolve).some((n) => own.has(n)))
    const id = threadId(t)
    replies.slice(0, 3).forEach((p, i) =>
      notify({
        icon: 'alternate_email',
        title: `あなた宛てのレス: ${log.title}`,
        body: `${p.no}: ${p.body}${i === 2 && replies.length > 3 ? `\n(ほか ${replies.length - 3} 件)` : ''}`,
        onClick: () => {
          selectTab(id)
          setJump({ tabId: id, no: p.no, seq: Date.now() })
        },
      }),
    )
  }

  /** タブにログを読み込み(手元のものをすぐ出す)、差分を取りに行く */
  const loadTab = async (s: LogStore, t: ThreadSummary) => {
    const id = threadId(t)
    const started = performance.now()
    const [local, own] = await Promise.all([s.loadThread(t), s.getOwnPosts(t)])
    // スマホ: スレ表示が右からすべり込んでいる間(SLIDE_MS)はレスを並べない。並べるのは重く、すべりがカクつくので、
    // すべり込み終わってから並べる(その間はヘッダーと書き込み欄だけの軽い画面)
    if (isMobile) {
      const wait = SLIDE_MS - (performance.now() - started)
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    }
    // レスを並べるのは重いので、急ぎでない更新にする(先に出したヘッダー・書き込み欄の操作を止めない)
    startTransition(() => patchTab(id, {
      log: local ?? { title: t.title, posts: [], cursor: null, postCount: 0, readNo: 0, status: 'active' },
      unreadFrom: (local?.readNo ?? 0) + 1,
      readNo: local?.readNo ?? 0,
      ownNos: new Set(own),
    }))
    await fetchThread(s, t, { keepUnread: true })
    // 手元にもサーバーにもレスがなければ、ないスレ(番号の間違い・とうに消えたスレ)として知らせる
    const after = await s.loadThread(t)
    if (!after || (after.posts.length === 0 && after.status === 'archived'))
      notify({ icon: 'error', title: 'スレが見つかりませんでした', body: `${t.title || t.key}\ndat 落ちして過去ログもないか、ない番号のスレです` })
  }

  /** タブを選んで、そのスレを見せる(1 画面でスレ一覧を出していても、スレ表示に切り替える)。record が false なら履歴に積まない */
  const selectTab = (id: string, record = true) => {
    setFocusPane('thread')
    const tab = tabsRef.current.find((t) => t.id === id)
    updateView((s) => showThread(s, id, record && tab ? threadEntry(tab.thread) : undefined))
    if (store && tab && !tab.log) void run('posts', () => loadTab(store, tab.thread))
  }

  /** スレを開く。record が false(戻る・進む)なら履歴に積まない */
  const openThread = (t: ThreadSummary, opts: { newTab?: boolean; record?: boolean } = {}) =>
    run('posts', async () => {
      if (!store) return
      const id = threadId(t)
      const existing = tabsRef.current.find((x) => x.id === id)
      if (existing) {
        // もう開いているスレは、そのタブに移って差分を取りに行く(スレ一覧で新着があるのを見て押したとき)
        selectTab(id, opts.record ?? true)
        if (existing.log) await fetchThread(store, existing.thread)
        return
      }
      // タブを使わないときは、いつも今のスレを置き換える
      // スマホはタブを使わない(閲覧履歴が代わり)。いつも今のスレを置き換える
      const inNew = settings.tabsEnabled && !isMobile && (opts.newTab ?? settings.openInNewTab)
      const current = view.current.activeId
      setTabs((ts) => {
        const i = ts.findIndex((x) => x.id === current)
        if (i < 0) return [...ts, newTab(t)]
        if (!inNew) return ts.map((x, j) => (j === i ? newTab(t) : x))
        return [...ts.slice(0, i + 1), newTab(t), ...ts.slice(i + 1)]
      })
      // 1 画面のときは、スレ一覧を閉じてスレ表示に切り替える(通知や本文のリンクから開いたときも)
      updateView((s) => showThread(s, id, (opts.record ?? true) ? threadEntry(t) : undefined))
      setFocusPane('thread')
      deletedIds.current.delete(id)
      await loadTab(store, t)
      // 読み込んでいる間にログを削除したら、閲覧履歴を読み直さない(消す前の DB から、消したスレが戻ってくる)
      if (deletedIds.current.has(id)) return
      if (history) setHistory(await store.history())
      await reloadRecent(store)
    })

  /** 閉じたタブのスレ(新しいものが後ろ)。Shift+X で開き直す */
  const closedTabs = useRef<ThreadSummary[]>([])
  /** タブを閉じる。stayOnList なら(1 画面でスレ一覧に戻るとき)、隣のタブは裏で選ぶだけにして、スレ表示も戻るの履歴も変えない */
  const closeTabs = (ids: string[], stayOnList = single && view.current.listOpen, remember = true) => {
    const ts = tabsRef.current
    setTabs(ts.filter((t) => !ids.includes(t.id)))
    // 閉じたタブは、開き直せるように覚えておく(ログを消して閉じたものは覚えない)
    if (remember) closedTabs.current = [...closedTabs.current, ...ts.filter((t) => ids.includes(t.id)).map((t) => t.thread)].slice(-CLOSED_TABS_MAX)
    // 選んでいたタブを閉じたら、右隣(なければ左隣)へ移る
    const next = nextAfterClose(view.current.activeId, ts.map((t) => t.id), ids)
    if (!next.changed) return
    if (next.id && !stayOnList) selectTab(next.id)
    else updateView((s) => selectQuietly(s, next.id))
  }

  /** ログを消してタブを閉じる(Delete キー・タブの右クリック・スレ表示のボタン) */
  const deleteLogs = (ids: string[], extra: ThreadSummary[] = [], stayOnList?: boolean) => {
    if (!store) return
    for (const id of ids) deletedIds.current.add(id)
    for (const t of extra) deletedIds.current.add(threadId(t))
    // タブで開いているスレに加えて、閲覧履歴から選んだスレ(タブにないもの)も消す
    const targets = new Map<string, ThreadSummary>()
    for (const t of tabsRef.current) if (ids.includes(t.id)) targets.set(t.id, t.thread)
    for (const t of extra) targets.set(threadId(t), t)
    // 先に画面から消す(DB の処理を待たない)
    // スマホはタブを使わない: 開いているスレを消したら、隣のタブを選ぶのではなく、消したスレを履歴から外して前の画面へ戻る
    const closingShown = isMobile && !!view.current.activeId && targets.has(view.current.activeId)
    closeTabs([...targets.keys()].filter((id) => tabsRef.current.some((t) => t.id === id)), closingShown || stayOnList, false)
    // 消したスレは戻る・進むの履歴からも外す(戻るで開き直さないように)
    updateView((s) => forget(s, new Set([...targets.values()].map((t) => threadEntry(t).key))))
    if (closingShown) {
      const back = view.current.stack[view.current.index]
      if (back) applyNav(back.value)
      else returnToList()
    }
    const gone = (t: ThreadSummary) => targets.has(threadId(t))
    setRecentHistory((list) => list.filter((t) => !gone(t)))
    setHistory((list) => list?.filter((h) => !gone(h.thread)))
    setStates((m) => {
      const boardUrl = boardRef.current?.url
      const keys = [...targets.values()].filter((t) => t.boardUrl === boardUrl).map((t) => t.key)
      if (keys.length === 0) return m
      const next = new Map(m)
      keys.forEach((k) => next.delete(k))
      return next
    })
    // DB は裏で消す。取りに行っている最中のスレは、終わるのを待ってから(消したあとに書き戻されないように)
    void run(null, async () => {
      await Promise.all(
        [...targets].map(async ([id, thread]) => {
          await inflight.current.get(id)?.catch(() => undefined)
          await store.deleteThread(thread)
        }),
      )
    })
  }

  /**
   * 開いているスレを手で更新する(更新ボタン・R キー・引っぱって更新)。
   * 続けて押してもサーバーに何度も取りに行かないよう、同じスレは REFRESH_COOLDOWN_MS あける(自動更新は別)
   */
  /** 開いているタブの「いま見えているところまでの既読をすぐ知らせる」関数(スレ表示が預ける) */
  const readFlush = useRef<(() => void) | undefined>(undefined)
  const refreshThread = () =>
    run('posts', async () => {
      if (!store || !activeTab) return
      const now = Date.now()
      // 既読の記録が間に合っていないと、「ここから未読」を古い位置で引き直してしまうので、先に記録する
      readFlush.current?.()
      if (now < (activeTab.refreshReadyAt ?? 0)) {
        // クールダウン中は取りに行かず、「ここから未読」だけ、いま読んだところの次に引き直す
        // (一番下まで読んでいれば全部既読になり、線は消える)
        const id = activeTab.id
        setTabs((ts) => ts.map((x) => (x.id === id && x.unreadFrom !== x.readNo + 1 ? { ...x, unreadFrom: x.readNo + 1 } : x)))
        return
      }
      // 明ける時刻をタブに持たせ、更新ボタンに残りを出す
      patchTab(activeTab.id, { refreshReadyAt: now + REFRESH_COOLDOWN_MS })
      await fetchThread(store, activeTab.thread)
    })

  // ── 書き込みとスレ一覧のクールダウン ──

  /** 書き込んだあとのクールダウンが明ける時刻(どのスレでも同じ。続けて書き込まないように) */
  const [postReadyAt, setPostReadyAt] = useState<number>()
  const postCooldownMs = settings.postCooldownSec * 1000
  /** クールダウン中なら、断る理由を返す */
  const postBlocked = (): PostResult | undefined => {
    const left = (postReadyAt ?? 0) - Date.now()
    if (left <= 0) return undefined
    return { status: 'error', message: `続けて書き込まないよう、あと ${Math.ceil(left / 1000)} 秒あけています` }
  }
  /** スレ一覧を手で更新したあとのクールダウンが明ける時刻 */
  const [listReadyAt, setListReadyAt] = useState<number>()
  /** スレ一覧を手で更新する(更新ボタン・引っぱって更新)。クールダウン中は取りに行かない */
  const manualListRefresh = (refresh: () => Promise<void> | void) => () => {
    const now = Date.now()
    if (now < (listReadyAt ?? 0)) return
    setListReadyAt(now + LIST_REFRESH_COOLDOWN_MS)
    return refresh()
  }

  const refreshAll = () =>
    run(null, async () => {
      if (!store) return
      setRefreshingAll(true)
      try {
        for (const t of tabsRef.current) {
          if (t.log) await fetchThread(store, t.thread)
          else await loadTab(store, t.thread)
        }
      } finally {
        setRefreshingAll(false)
      }
    })

  /**
   * 自動更新(開いているタブだけ)。手での更新とは分け、クールダウンは始めない。
   * 次のときは取りに行かない(サーバーに無駄な読み込みを送り続けないため):
   * - アプリが見えていない(最小化など)
   * - dat 落ち・1000 到達で、もう増えないスレ
   * 前の取得が終わっていなければ、fetchThread がその回を飛ばす
   */
  const autoRefresh = () => {
    const t = activeTab
    if (!store || !t?.log || !isAppVisible()) return
    if (t.log.status === 'archived' || isFull(t.thread, t.log.posts)) return
    readFlush.current?.()
    void fetchThread(store, t.thread).catch(() => undefined)
  }
  const autoRefreshRef = useRef(autoRefresh)
  autoRefreshRef.current = autoRefresh
  useEffect(() => {
    if (!activeId || settings.autoRefreshSec <= 0) return
    const id = setInterval(() => autoRefreshRef.current(), settings.autoRefreshSec * 1000)
    return () => clearInterval(id)
  }, [activeId, settings.autoRefreshSec])

  // キー操作: Ctrl+W で閉じる、Ctrl+Tab / Ctrl+PageDown で次、Ctrl+Shift+Tab / Ctrl+PageUp で前
  // Delete で開いているスレのログを消してタブを閉じる(文字を入力しているときは除く)
  /** キー操作の対象: 選んでいるタブがあれば、それと開いているタブ。なければ開いているタブだけ */
  const targetTabs = () => {
    const ids = tabsRef.current.map((t) => t.id).filter((id) => selectedTabs.has(id) || id === activeId)
    return ids.length > 0 ? ids : activeId ? [activeId] : []
  }
  // 押し続けて切り替えている途中の、選んでいる印の付いたタブ(まだスレ表示は切り替えていない)
  const [tabPreview, setTabPreview] = useState<string>()
  const tabPreviewRef = useRef<string | undefined>(undefined)
  const tabCommitTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const commitTabPreview = () => {
    clearTimeout(tabCommitTimer.current)
    const id = tabPreviewRef.current
    tabPreviewRef.current = undefined
    setTabPreview(undefined)
    if (id) keyRef.current.selectTab(id)
  }
  /** F5 で更新するもの。キー操作を受け取っている方(上に線が出ている方)。スレを開いていなければスレ一覧 */
  const reload = () => {
    if (activeTab?.log && !listFocused) return void refreshThread()
    const list = favView ? refreshFavThreads : history ? refreshHistory : board ? () => openBoard(board, false) : undefined
    if (list) void manualListRefresh(list)()
  }
  /** Ctrl+E(設定で変えられる): キー操作を受け取る方を、スレ一覧とスレ表示で入れ替える(1 画面なら見せる方を入れ替える) */
  const toggleFocus = () => {
    // 入力欄にいたら抜ける(そのままだと J・K などが入力欄に入ってしまう)
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    if (single) {
      if (threadShown) returnToList()
      else if (activeId) selectTab(activeId)
      return
    }
    if (activeId !== undefined) setFocusPane(listFocused ? 'thread' : 'list')
  }
  /**
   * 未読の巡回: 未読のあるタブ → 未読のあるお気に入りのスレ の順に、いま見ているものの次へ移り、新着の頭から読む。
   * 新しく取りには行かない(タブは手元の未読、お気に入りのスレは見張りで分かったレス数で決める)
   */
  const patrol = () => {
    const list: { id: string; open: () => void }[] = []
    for (const t of tabsRef.current) {
      if (!t.log || t.log.posts.length <= t.readNo) continue
      const id = t.id
      const from = t.readNo + 1
      list.push({
        id,
        open: () => {
          selectTab(id)
          setJump({ tabId: id, no: from, seq: Date.now() })
        },
      })
    }
    for (const f of favThreads) {
      const id = threadId(f.thread)
      if (f.postCount === 0 || list.some((x) => x.id === id)) continue
      if ((favCounts.get(id) ?? f.postCount) <= f.readNo) continue
      list.push({ id, open: () => void openThread(f.thread) })
    }
    if (list.length === 0) return notify({ icon: 'done_all', title: '未読のスレはありません', body: '開いているタブとお気に入りのスレは、全部読んであります' })
    const i = list.findIndex((x) => x.id === activeId)
    list[(i + 1) % list.length].open()
  }

  /** コマンドパレットに並べるもの。開いたときに、いまの板・タブ・お気に入りから作る */
  const paletteItems = (): PaletteItem[] => {
    const set = (patch: Partial<AppSettings>) => {
      for (const [k, v] of Object.entries(patch)) updateSetting(k as keyof AppSettings, v as never)
    }
    return [
      ...tabsRef.current.map((t) => ({ group: 'タブ', label: t.log?.title || t.thread.title, icon: 'tab', run: () => selectTab(t.id) })),
      ...(favorites ?? []).map((b) => ({
        group: '板',
        label: settings.boardMeta[b.url]?.alias || b.name,
        keywords: `${b.name} ${b.url}`,
        icon: 'forum',
        run: () => void openBoard(b),
      })),
      ...favThreads.map((f) => ({ group: 'お気に入りのスレ', label: f.thread.title, icon: 'star', run: () => void openThread(f.thread) })),
      ...recentHistory.map((t) => ({ group: '最近見たスレ', label: t.title, icon: 'history', run: () => void openThread(t) })),
      { group: '開く', label: '閲覧履歴', icon: 'history', run: () => void openHistory() },
      { group: '開く', label: 'お気に入りのスレ', icon: 'bookmarks', run: () => void openFavThreads() },
      { group: '開く', label: '設定', icon: 'settings', run: () => setSettingsTab('display') },
      ...KEY_ACTIONS.filter((a) => a.where === 'app' && a.key !== 'palette').map((a) => ({
        group: '操作',
        label: a.name,
        keywords: keymap[a.key].join(' '),
        icon: 'bolt',
        run: () => appKey(a.key),
      })),
      ...PICKABLE_SCHEMES.filter((c) => c.key !== 'light').map((c) => ({ group: '配色', label: c.name, icon: 'palette', run: () => set(pickSchemeNow(settings, c.key)) })),
      ...POST_STYLES.map((p) => ({ group: 'レスの見た目', label: p.name, keywords: p.note, icon: 'style', run: () => updateSetting('postStyle', p.key) })),
      ...(isMobile
        ? []
        : [
            { group: '表示の密度', label: '一覧表示', icon: 'view_list', run: () => updateSetting('density', 'list') },
            { group: '表示の密度', label: '高密度', icon: 'density_small', run: () => updateSetting('density', 'dense') },
          ]),
    ]
  }

  /** アプリ全体のキー操作(どちらにキーが向いていても効く。割り当ては設定で変えられる) */
  const appKey = (action: KeyAction): boolean => {
    const ids = tabsRef.current.map((t) => t.id)
    const i = activeId ? ids.indexOf(activeId) : -1
    switch (action) {
      case 'nextTab':
      case 'prevTab':
        if (ids.length > 0) selectTab(ids[(i + (action === 'nextTab' ? 1 : -1) + ids.length) % ids.length])
        return true
      case 'back':
        goNav(-1)
        return true
      case 'forward':
        goNav(1)
        return true
      case 'closeTab':
        // スマホはタブを使わないので、閉じるのは戻ると同じ
        if (isMobile) {
          if (canBack(view.current)) goNav(-1)
          else returnToList()
          return true
        }
        setSelectedTabs(new Set())
        closeTabs(targetTabs())
        return true
      case 'reopenTab': {
        const t = closedTabs.current.pop()
        if (t) void openThread(t, { newTab: true })
        return true
      }
      case 'focusUrl': {
        const input = document.getElementById('address-input')
        if (input instanceof HTMLInputElement) {
          input.focus()
          input.select()
        }
        return true
      }
      case 'toggleSidebar':
        updateSetting('sidebarCollapsed', !settings.sidebarCollapsed)
        return true
      case 'zoomIn':
      case 'zoomOut':
        updateSetting(FONT_PX_KEY, Math.min(FONT_PX_MAX, Math.max(FONT_PX_MIN, baseFontPx(settings) + (action === 'zoomIn' ? 1 : -1))))
        return true
      case 'help':
        setKeyHelpOpen(true)
        return true
      case 'patrol':
        patrol()
        return true
      case 'palette':
        setPaletteOpen(true)
        return true
      case 'switchPane':
        toggleFocus()
        return true
      default:
        return false
    }
  }
  /** Shift+Delete: 確かめてから(設定で確かめないことにしていれば、すぐ)ログを消して閉じる */
  const confirmDeleteLogs = (ids: string[]) => {
    if (!settings.confirmDeleteLog) {
      setSelectedTabs(new Set())
      return void deleteLogs(ids)
    }
    setDeleteConfirm(ids)
  }
  const keyRef = useRef({ closeTabs, selectTab, activeId, deleteLogs, targetTabs, setSelectedTabs, reload, toggleFocus, appKey, keymap, confirmDeleteLogs, back: () => goNav(-1), forward: () => goNav(1) })
  keyRef.current = { closeTabs, selectTab, activeId, deleteLogs, targetTabs, setSelectedTabs, reload, toggleFocus, appKey, keymap, confirmDeleteLogs, back: () => goNav(-1), forward: () => goNav(1) }
  // マウスで押したボタン・リンクには、フォーカスを移さない。フォーカスがボタンに残ると、Space・Enter がそのボタンを押す動きに
  // 取られて、キー操作(J・K など)が効かないことがあるため。押した動き(click)はそのまま起きる。
  // ダイアログの中は Tab で回るので、ふつうどおりフォーカスを移す
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      const el = (e.target as HTMLElement | null)?.closest?.('button, a[href], [role="button"]')
      if (!el || el.closest('[data-modal]')) return
      // スマホはキー操作がないので、ふつうどおりフォーカスを移す(書き込み欄から外れてキーボードがしまわれる)。
      // 止めると欄にフォーカスが残り、絞り込みなどのボタンを押すたびにキーボードが出てしまう。
      // ただし書き込み欄の中のボタン(送る・＋)は、書き続けられるようキーボードを出したままにする
      if (isMobile && !el.closest('[data-composer]')) return
      e.preventDefault()
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [])
  // マウスの戻る・進むボタン(横のボタン)。WebView がページの戻る・進むをしないよう、押したときに止める
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) e.preventDefault()
    }
    const onUp = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return
      e.preventDefault()
      if (e.button === 3) keyRef.current.back()
      else keyRef.current.forward()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modalOpen()) return // ダイアログが開いている間は、後ろの画面を動かさない
      // F5・Ctrl+R: 画面ごと読み直すのではなく(WebView2 のショートカットは Rust 側で切ってある)、
      // スレを開いていればそのスレを、開いていなければスレ一覧を更新する(どちらもクールダウンあり)。どちらもなければ何もしない
      // Alt+← →: 戻る・進む
      if (e.altKey && !e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        if (e.key === 'ArrowLeft') keyRef.current.back()
        else keyRef.current.forward()
        return
      }
      if (isReloadKey(e)) {
        e.preventDefault()
        if (e.repeat) return // 押し続けても続けて更新しない
        keyRef.current.reload()
        return
      }
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')
      // Delete: タブを閉じる。Shift+Delete: 確かめてから、ログを削除して閉じる(取り消せないので 1 キーではしない)
      if (e.key === 'Delete' && !typing && !e.ctrlKey && !e.altKey) {
        const { closeTabs, deleteLogs, targetTabs, setSelectedTabs } = keyRef.current
        const targets = targetTabs()
        if (targets.length === 0) return
        e.preventDefault()
        if (!e.shiftKey) {
          setSelectedTabs(new Set())
          return closeTabs(targets)
        }
        keyRef.current.confirmDeleteLogs(targets)
        return
      }
      // 割り当てを変えられる、アプリ全体の操作(タブ・戻る/進む・URL 欄 など)。
      // 入力欄の中では、Ctrl 付きのもの(Ctrl+L・Ctrl+B など)だけ受ける
      if (!e.defaultPrevented && !e.altKey && (!typing || e.ctrlKey) && !e.repeat) {
        const { keymap, appKey } = keyRef.current
        const action = actionFor(keymap, keyString(e))
        if (action && appKey(action)) {
          e.preventDefault()
          return
        }
      }
      if (!e.ctrlKey) return
      const { closeTabs, selectTab, activeId, targetTabs, setSelectedTabs } = keyRef.current
      const ids = tabsRef.current.map((t) => t.id)
      // 押し続けているあいだは、選んでいる印(tabPreview)から数える
      const from = tabPreviewRef.current ?? activeId
      const i = from ? ids.indexOf(from) : -1
      /**
       * Ctrl+Tab などでタブを切り替える。1 回押しただけならすぐ切り替える。
       * 押し続けた(キーの自動の連打)ときは、タブ列の印だけを動かし、スレ表示の切り替えは
       * 指を離すか連打が止まるまで待って 1 回だけにする(1 回ごとに描き直しや読み込みが走って固まるため)
       */
      const step = (d: number) => {
        if (ids.length === 0) return
        e.preventDefault()
        const next = ids[(i + d + ids.length) % ids.length]
        if (!e.repeat && tabPreviewRef.current === undefined) return selectTab(next)
        tabPreviewRef.current = next
        setTabPreview(next)
        clearTimeout(tabCommitTimer.current)
        tabCommitTimer.current = setTimeout(commitTabPreview, TAB_REPEAT_SETTLE_MS)
      }
      if (e.key.toLowerCase() === 'w') {
        e.preventDefault()
        setSelectedTabs(new Set())
        if (e.shiftKey) closeTabs(ids)
        else closeTabs(targetTabs())
      } else if (e.key === 'Tab') step(e.shiftKey ? -1 : 1)
      else if (e.key === 'PageDown') step(1)
      else if (e.key === 'PageUp') step(-1)
    }
    // Ctrl を離したら、選んでいたタブにすぐ切り替える
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' && tabPreviewRef.current !== undefined) commitTabPreview()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  // 外付けのコネクタ(connectors/ のフォルダ)を読み込む。タブを戻す・起動時の板を開くのは、読み込み終えてから
  // (外付けのコネクタのスレを開いたまま閉じていたとき、コネクタがまだないと開けないため)
  const [externalConnectors, setExternalConnectors] = useState<ExternalConnectorInfo[]>([])
  const [externalReady, setExternalReady] = useState(false)
  const reloadExternalConnectors = (approvals = settingsRef.current.connectors) =>
    loadExternalConnectors(ctx, approvals)
      .then(setExternalConnectors)
      .catch(backgroundError('外付けのコネクタの読み込み'))
  useEffect(() => {
    if (!settingsLoaded || externalReady) return
    void reloadExternalConnectors(settings.connectors).finally(() => setExternalReady(true))
  }, [settingsLoaded])

  // 開いていたタブを次の起動で戻す。戻したタブは、選んだときに読み込む
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current || !settingsLoaded || !store || !externalReady) return
    restored.current = true
    const ts = settings.openTabs.map((s) => newTab(fromSaved(s)))
    setTabs(ts)
    const active = ts.find((t) => t.id === settings.activeTab) ?? ts[0]
    if (active) {
      updateView((s) => selectQuietly(s, active.id))
      void run('posts', () => loadTab(store, active.thread))
    }
  }, [settingsLoaded, store, externalReady])

  const savedTabs = JSON.stringify(
    tabs.map(
      (t): SavedTab => ({
        connectorId: t.thread.connectorId,
        boardUrl: t.thread.boardUrl,
        key: t.thread.key,
        title: t.log?.title || t.thread.title,
        postCount: t.thread.postCount,
        createdAt: t.thread.createdAt?.getTime(),
      }),
    ),
  )
  useEffect(() => {
    if (restored.current) updateSetting('openTabs', JSON.parse(savedTabs) as SavedTab[])
  }, [savedTabs])
  useEffect(() => {
    if (restored.current) updateSetting('activeTab', activeId ?? '')
  }, [activeId])

  /**
   * 書き込み。成功したら差分を取り直し、書き込んだレスを「自分の書き込み」として覚える。
   * レス番号はサーバーが教えてくれればそれを、なければ新着の中から本文が同じものを探す
   */
  /** 書き込みの削除キー(ふたば)。まだなければ、英数字 8 文字を作って覚える */
  const deleteKey = () => {
    if (settings.postDeleteKey) return settings.postDeleteKey
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    const key = [...crypto.getRandomValues(new Uint8Array(8))].map((n) => chars[n % chars.length]).join('')
    updateSetting('postDeleteKey', key)
    return key
  }

  const submitPost = async (input: PostInput): Promise<PostResult> => {
    if (!store || !activeTab) return { status: 'error', message: 'スレを開いていません' }
    const blocked = postBlocked()
    if (blocked) return blocked
    const t = activeTab.thread
    const connector = connectorOf(t.connectorId)
    if (!connector.createPost) return { status: 'error', message: 'この掲示板には書き込めません' }
    const withAccounts = { ...input, accounts: postAccountIds(t.connectorId, t.boardUrl), deleteKey: deleteKey() }
    return afterPost(t, input, await connector.createPost(t, withAccounts, ctx))
  }

  /** 書き込み確認で承諾したとき。成功したら、ふつうの書き込みと同じ後始末をする */
  const confirmPost = async (confirm: PostConfirm, input: PostInput): Promise<PostResult> => {
    if (!store || !activeTab) return { status: 'error', message: 'スレを開いていません' }
    const t = activeTab.thread
    const connector = connectorOf(t.connectorId)
    if (!connector.submitConfirm) return { status: 'error', message: 'この掲示板では承諾して書き込めません' }
    return afterPost(t, input, await connector.submitConfirm(confirm, ctx))
  }

  /** 書き込みが通ったら、差分を取り直し、書き込んだレスを「自分の書き込み」として覚える */
  const afterPost = async (t: ThreadSummary, input: PostInput, r: PostResult): Promise<PostResult> => {
    if (!store || r.status !== 'ok') return r
    if (postCooldownMs > 0) setPostReadyAt(Date.now() + postCooldownMs)
    // 板ごとの既定値がある欄は、アプリ全体の「最後に使った値」を書き換えない
    const meta = settings.boardMeta[t.boardUrl]
    if (meta?.defaultName === undefined && input.name !== settings.postName) updateSetting('postName', input.name)
    if (meta?.defaultMail === undefined && input.mail !== settings.postMail) updateSetting('postMail', input.mail)
    const before = (await store.loadThread(t))?.postCount ?? 0
    await fetchThread(store, t, { force: true })
    const after = await store.loadThread(t)
    const normalize = (s: string) => s.replace(/\s+/g, '')
    // 書いたレスの番号: サーバーが教えてくれたもの(ふたばは板の本当の番号 ref)、なければ本文が同じ新しいレス
    const no =
      r.resNumber ??
      (r.ref !== undefined ? after?.posts.find((p) => p.ref === r.ref)?.no : undefined) ??
      after?.posts
        .filter((p) => p.no > before)
        .reverse()
        .find((p) => normalize(p.body) === normalize(input.body))?.no
    if (no) {
      await store.addOwnPost(t, no)
      patchTab(threadId(t), { ownNos: new Set(await store.getOwnPosts(t)) })
    }
    // 書き込み履歴には、番号が分からなくても書いた内容を残す。URL から開いたスレはスレタイが空なので、ログのものを使う
    await store.addPostHistory({ ...t, title: after?.title || t.title }, { no, name: input.name, mail: input.mail, body: input.body })
    return r
  }

  /**
   * スレ立て。成功したらスレ一覧を取り直して同じスレタイのスレを探し、新しいタブで開く。
   * サーバーの一覧に載るまで少しかかることがあるので、見つからなければ間を置いて探し直す
   */
  const createThread = async (input: NewThreadInput): Promise<PostResult> => {
    if (!store || !board) return { status: 'error', message: '板を開いていません' }
    const blocked = postBlocked()
    if (blocked) return blocked
    const b = board
    const connector = connectorOf(b.connectorId)
    if (!connector.createThread) return { status: 'error', message: 'この掲示板ではスレを立てられません' }
    const withAccounts = { ...input, accounts: postAccountIds(b.connectorId, b.url), deleteKey: deleteKey() }
    return afterThread(b, input, await connector.createThread(b, withAccounts, ctx))
  }

  /** スレ立ての書き込み確認で承諾したとき */
  const confirmThread = async (confirm: PostConfirm, input: NewThreadInput): Promise<PostResult> => {
    if (!store || !board) return { status: 'error', message: '板を開いていません' }
    const connector = connectorOf(board.connectorId)
    if (!connector.submitConfirm) return { status: 'error', message: 'この掲示板では承諾して書き込めません' }
    return afterThread(board, input, await connector.submitConfirm(confirm, ctx))
  }

  /** スレが立ったら、スレ一覧を取り直して同じスレタイのスレを探し、新しいタブで開く */
  const afterThread = async (b: Board, input: NewThreadInput, r: PostResult): Promise<PostResult> => {
    if (!store || r.status !== 'ok') return r
    if (postCooldownMs > 0) setPostReadyAt(Date.now() + postCooldownMs)
    const connector = connectorOf(b.connectorId)

    if (input.name !== settings.postName) updateSetting('postName', input.name)
    if (input.mail !== settings.postMail) updateSetting('postMail', input.mail)
    const normalize = (s: string) => s.replace(/\s+/g, '')
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((ok) => setTimeout(ok, 1500))
      const list = await connector.listThreads(b, ctx)
      if (boardRef.current?.url === b.url) setThreads(list)
      const found = list
        .filter((t) => normalize(t.title) === normalize(input.title))
        .sort((x, y) => (y.createdAt?.getTime() ?? 0) - (x.createdAt?.getTime() ?? 0))[0]
      if (found) {
        await store.addOwnPost(found, 1)
        await store.addPostHistory(found, { no: 1, name: input.name, mail: input.mail, body: input.body })
        setNewThreadOpen(false)
        await openThread(found, { newTab: true })
        return r
      }
    }
    return { status: 'ok', message: `${r.message}(スレ一覧ではまだ見つかりません。少し待ってから一覧を更新してください)` }
  }

  /**
   * 本文のリンクを開く。アプリで読めるスレの URL なら新しいタブで開き(スレ一覧はそのまま)、
   * それ以外や、開けなかったときはブラウザで開く
   */
  const openLink = async (url: string) => {
    if (!isAppThreadUrl(url)) return settingsRef.current.openLinksInApp ? setReaderUrl(url) : openUrl(url)
    try {
      const r = await resolve(url)
      if (r.thread) return await openThread(r.thread, { newTab: true })
    } catch {
      // 開けなければブラウザで
    }
    return openUrl(url)
  }

  const openUrlInApp = (url: string) =>
    run(null, async () => {
      const r = await resolve(url)
      await openBoard(r.board)
      if (r.thread) await openThread(r.thread)
    })

  // スマホ: 何かを開いたら(板・スレ・履歴・設定・URL)、サイドバーの引き出しを閉じる
  useEffect(() => {
    if (isMobile) setDrawerOpen(false)
  }, [board?.url, history, favView, activeId, settingsTab, urlPrompt !== undefined])

  /** 文字を打つ欄(検索欄・書き込み欄)にフォーカスがあれば、外してキーボードをしまう。外したら true */
  const blurTyping = (): boolean => {
    const el = document.activeElement
    if (!(el instanceof HTMLElement) || !el.matches('input, textarea, [contenteditable="true"]')) return false
    // 検索欄に文字が入っていれば、文字も消して元の表示に戻す(欄の Esc と同じ。検索欄は Esc で言葉を消して閉じる)
    if (el instanceof HTMLInputElement && el.matches('[data-search]') && el.value) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    }
    el.blur()
    return true
  }
  /**
   * 検索欄から抜けたあとも言葉が残っていれば(見えている検索欄)、その欄で Esc を押したことにして、言葉を消して検索を閉じる。
   * 外したら true
   */
  const clearSearchText = (): boolean => {
    const input = [...document.querySelectorAll<HTMLInputElement>('input[data-search]')].find((el) => el.value && el.offsetParent !== null)
    if (!input) return false
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    return true
  }
  /** いま見ている画面(スレ表示かスレ一覧)で絞り込み・検索をしていれば、Esc を押したことにして外す。外したら true */
  const clearFiltering = (): boolean => {
    const screen = single && threadShown ? 'thread' : 'list'
    if (!document.querySelector(`[data-filtering="${screen}"]`)) return false
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    return true
  }

  // ── スマホ: スワイプの操作 ──
  /** 操作を実行する。アプリ全体の操作はそのまま、スレ表示・スレ一覧の操作は、割り当てたキーを押したことにして渡す */
  const runAction = (action: string) => {
    // 戻る・引き出しは、絞り込み・検索をしていればまずそれを外す(元の Web アプリと同じ)
    // 文字を打っている欄から抜けるのが先(検索欄で戻ると、まず欄から抜ける)
    if (action === 'back' && blurTyping()) return
    if (action === 'back' && clearSearchText()) return
    // レスのポップアップが出ていれば、それを閉じるのが先(スレ表示が Esc でまとめて閉じる)。
    // スレ一覧で選んでいる途中なら、選ぶのをやめる(Esc)
    if (action === 'back' && (document.querySelector('.post-popup') || document.querySelector('[data-selecting]'))) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      return
    }
    if ((action === 'back' || action === 'drawer') && clearFiltering()) return
    if (action === 'drawer') return setDrawerOpen(true)
    // 設定で確かめることにしていれば、確かめてから消す(Shift+Delete と同じ)
    if (action === 'deleteLog') {
      const targets = targetTabs()
      if (targets.length > 0) confirmDeleteLogs(targets)
      return
    }
    if (appKey(action as KeyAction)) return
    const key = keymap[action as KeyAction]?.[0]
    if (!key) return
    for (const init of keyEventsOf(key)) window.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }))
  }
  /** 画面の左の端から右へなぞったら、操作の代わりにサイドバーの引き出しを開く */
  const edgeSwipe = useRef(false)
  // スレを開いているか、スレ一覧かで、割り当てを変える
  const gestures = settings.swipeGestures[single && threadShown ? 'thread' : 'list'] ?? {}
  const swipeMap: SwipeMap = Object.fromEntries(
    [...Object.entries(gestures).filter(([, a]) => a), ...(gestures.right ? [] : [['right', '']])].map(([seq, action]) => [
      seq,
      {
        // 名前は、なぞり始めた場所(左の端か)で変わるので、読むときに決める
        get label() {
          return seq === 'right' && edgeSwipe.current ? 'メニュー' : gestureActionName(action)
        },
        onCommit: () => {
          // 設定で行をつまんで動かしている間は、ジェスチャーにしない
          if (document.body.dataset.dragSorting !== undefined) return
          // ダイアログ(スレ立て・NG の追加・下から出るメニューなど)の上では、戻るのジェスチャーで閉じるだけにする
          if (modalOpen()) {
            if (action === 'back' || seq === 'right')
              (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
            return
          }
          if (seq === 'right' && edgeSwipe.current) setDrawerOpen(true)
          else if (action) runAction(action)
        },
      },
    ]),
  )
  const swipe = useSwipeGesture(swipeMap, settings.gestureSensitivity)
  // 指の動きは画面全体(document)で受ける。アプリの枠の中だけで受けると、body の直下に出した
  // レスのポップアップ・スレ立てなどの上でなぞったときに届かない。
  // 画像ビューアー(自分で指の操作を受け、外へ伝えない)と引き出しの中は除く
  const swipeRef = useRef(swipe)
  swipeRef.current = swipe
  useEffect(() => {
    if (!isMobile) return
    const start = (e: TouchEvent) => {
      // スライダー(文字の大きさなど)の上で始まったなぞりは、スライダーを動かすためのもの
      // 設定の並べ替えのつまみも同じ(つまんで動かすためのもの)
      if ((e.target as Element | null)?.closest?.('[data-lightbox], [data-drawer], input[type="range"], [data-drag-handle], [data-gesture-pad]')) return
      edgeSwipe.current = e.touches[0].clientX < 24
      swipeRef.current.onTouchStart(e)
    }
    const end = (e: TouchEvent) => swipeRef.current.onTouchEnd(e)
    const cancel = () => swipeRef.current.onTouchCancel()
    document.addEventListener('touchstart', start, { passive: true })
    document.addEventListener('touchend', end)
    document.addEventListener('touchcancel', cancel)
    return () => {
      document.removeEventListener('touchstart', start)
      document.removeEventListener('touchend', end)
      document.removeEventListener('touchcancel', cancel)
    }
  }, [])

  // スマホ: Android の戻るボタン(・戻るジェスチャー)。開いている画面を、上に重なっているものから順に閉じる:
  // ダイアログ(設定など。Esc を押したことにして閉じる)→ 引き出し → スレ表示(一覧に戻る)→ 戻るの履歴
  const backRef = useRef<() => void>(() => {})
  backRef.current = () => {
    if (modalOpen() || document.querySelector('[data-lightbox]')) {
      ;(document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      return
    }
    if (drawerOpen) return setDrawerOpen(false)
    if (blurTyping()) return
    if (clearSearchText()) return
    if (document.querySelector('[data-selecting]')) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      return
    }
    // レスのポップアップが出ていれば、Esc を押したことにして閉じる(スレ表示が Esc でいちばん上から閉じる)
    if (document.querySelector('.post-popup')) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      return
    }
    if (clearFiltering()) return
    if (single && threadShown) return returnToList()
    if (canBack(view.current)) goNav(-1)
  }
  useEffect(() => {
    if (!isMobile) return
    let unregister: (() => void) | undefined
    let cancelled = false
    void onBackButtonPress(() => backRef.current()).then((l) => {
      if (cancelled) void l.unregister()
      else unregister = () => void l.unregister()
    })
    return () => {
      cancelled = true
      unregister?.()
    }
  }, [])

  /** 古いログを整理する(設定の日数で)。開いているタブは残す */
  const pruneLogs = async (): Promise<number> => {
    const days = settingsRef.current.logRetentionDays
    if (!store || days <= 0) return 0
    const n = await store.pruneLogs(
      Date.now() - days * 86_400_000,
      tabsRef.current.map((t) => ({ boardUrl: t.thread.boardUrl, key: t.thread.key })),
    )
    updateSetting('lastLogPruneAt', Date.now())
    if (n > 0) await reloadRecent(store)
    return n
  }
  // 起動して少し経ってから、1 日に 1 回だけ古いログを整理する(起動の邪魔をしないように)
  useEffect(() => {
    if (!settingsLoaded || !store || !externalReady) return
    if (settings.logRetentionDays <= 0 || Date.now() - settings.lastLogPruneAt < 86_400_000) return
    const timer = setTimeout(() => void pruneLogs().catch(backgroundError('古いログの整理')), 30_000)
    return () => clearTimeout(timer)
  }, [settingsLoaded, store, externalReady])

  // 起動時に開く板(設定)。設定とお気に入りを読み終えてから一度だけ
  const startupDone = useRef(false)
  useEffect(() => {
    if (startupDone.current || !settingsLoaded || !favorites || !externalReady) return
    startupDone.current = true
    const url = settings.startupBoardUrl === '@last' ? settings.lastBoardUrl : settings.startupBoardUrl
    if (!url) return
    const fav = favorites.find((b) => b.url === url)
    if (fav) void openBoard(fav)
    else void openUrlInApp(url)
  }, [settingsLoaded, favorites, settings.startupBoardUrl, externalReady])

  // タブを使わなくしたら、開いているスレ以外のタブを閉じる(戻したタブも 1 つにする)
  useEffect(() => {
    if ((!settings.tabsEnabled || isMobile) && tabs.length > 1) setTabs((ts) => ts.filter((t) => t.id === activeId).slice(0, 1))
  }, [settings.tabsEnabled, tabs.length, activeId])

  // 開いているスレの板と、スレ一覧に出している板の設定を、まだ取っていなければ取る
  // (名無しの省略と、書き込みの長さの上限に使う)
  useEffect(() => {
    const targets = [
      activeTab && { connectorId: activeTab.thread.connectorId, url: activeTab.thread.boardUrl },
      board && { connectorId: board.connectorId, url: board.url },
    ]
    for (const b of targets) {
      if (!b || boardInfoAsked.current.has(b.url)) continue
      boardInfoAsked.current.add(b.url)
      const connector = findConnector(b.connectorId)
      if (!connector?.boardInfo) continue
      void connector
        .boardInfo({ connectorId: b.connectorId, url: b.url, name: '' }, ctx)
        .then((info) => setBoardInfos((m) => new Map(m).set(b.url, info)))
        .catch(() => undefined)
    }
  }, [activeTab?.thread, board])

  // 期限の切れた一時 NG を片づける
  useEffect(() => {
    if (!settingsLoaded) return
    const kept = pruneExpired(settings.ngRules)
    if (kept.length !== settings.ngRules.length) updateSetting('ngRules', kept)
  }, [settingsLoaded])

  /**
   * 既読位置を進める。スクロールのたびに呼ばれるので、DB は書くだけにして読み直さず、
   * 手元の状態(タブとスレ一覧)を 1 件だけ書き換える
   */
  const markRead = useEvent((t: ThreadSummary, no: number) => {
    if (!store) return
    const id = threadId(t)
    // ログを削除したスレの、閉じるときに届いた既読は数えない
    if (deletedIds.current.has(id)) return
    setTabs((ts) => ts.map((x) => (x.id === id && no > x.readNo ? { ...x, readNo: no } : x)))
    if (boardRef.current?.url === t.boardUrl)
      setStates((m) => {
        const cur = m.get(t.key)
        if (!cur || no <= cur.readNo) return m
        return new Map(m).set(t.key, { ...cur, readNo: no })
      })
    patchFav(t, (f) => (no > f.readNo ? { ...f, readNo: no } : f))
    // 閲覧履歴の一覧を出しているときは、その行の既読も進める(開いた時点のまま残り、未読の印が消えなかった)
    setHistory((list) => list?.map((h) => (threadId(h.thread) === id && no > h.readNo ? { ...h, readNo: no } : h)))
    void store.markRead(t, no).catch(backgroundError('既読の保存'))
  })

  // ── お気に入り・サイト ──

  const reloadFavorites = async (s: LogStore) => setFavorites(await s.listFavorites())

  const toggleFavorite = (b: Board) => {
    if (!store) return
    const on = favorites?.some((f) => f.url === b.url)
    const board = { connectorId: b.connectorId, url: b.url, name: b.name }
    // 先に画面を変えてから、DB は裏で書く
    setFavorites((list) => (on ? list?.filter((f) => f.url !== b.url) : [...(list ?? []), board]))
    void run(null, () => (on ? store.removeFavorite(b.url) : store.addFavorite(board)))
  }

  const addFavoriteUrl = async (url: string) => {
    if (!store) return
    const r = await resolve(url)
    await store.addFavorite(r.board)
    await reloadFavorites(store)
  }

  const addSite = async (name: string, menuUrl: string) => {
    if (!store) return
    const host = new URL(menuUrl).host // URL として読めなければここで例外になる
    // サイトの入口を受け持つコネクタ(hono-bbs の /boards など)があればそれ、なければ 2ch 互換(bbsmenu)
    const connectorId = allConnectors().find((c) => c.handlesSite?.(menuUrl))?.id ?? '2ch-compat'
    const s: SiteConfig = { connectorId, name: name || host, menuUrl }
    await store.addSite(s)
    setSites(await store.listSites())
  }

  const removeSite = (menuUrl: string) =>
    run(null, async () => {
      if (!store) return
      await store.removeSite(menuUrl)
      const list = await store.listSites()
      setSites(list)
    })

  // ── NG ──

  const isNgPost = useMemo(() => postMatcher(settings.ngRules), [settings.ngRules])
  const isNgThread = useMemo(() => threadMatcher(settings.ngRules), [settings.ngRules])
  // キーワードに合うスレが立ったら知らせる(お気に入り板を見張る)
  useKeywordWatch({
    enabled: !!store,
    settings,
    updateSetting,
    favorites,
    listForWatch,
    isNgThread,
    notify,
    openThread: (t) => latest.current.openThread(t),
  })
  const addNg = useCallback(
    (rule: NgRule) => updateSetting('ngRules', [...settings.ngRules, rule]),
    [settings.ngRules, updateSetting],
  )

  // 最近開いたタブ(KEEP_TABS 個まで)はスレ表示を残しておく。開いているタブを先頭に、閉じたタブは外す
  const [keptIds, setKeptIds] = useState<string[]>([])
  // タブの切り替えは、タブの帯(どれを選んだか)を先に描き、スレ表示の組み立て(初めて開くタブはレスを並べる)は後回しにする。
  // 組み立ての途中は、前のスレ表示の上に細い帯を流す
  // ただし、まだログを読んでいないスレ(開いたばかり)は、ヘッダーと書き込み欄だけの軽い画面なので、すぐに出す。
  // レスは手元のログを読めたら埋め、サーバーから新しい分が届いたら足す
  const deferredPane = useDeferredValue(activeId)
  const paneId = activeTab && !activeTab.log ? activeId : deferredPane
  const switchingPane = paneId !== activeId
  useEffect(() => {
    if (!paneId) return
    setKeptIds((prev) => [paneId, ...prev.filter((x) => x !== paneId)].slice(0, KEEP_TABS))
  }, [paneId])
  const aliveIds = new Set(tabs.map((t) => t.id))
  // どれを残すかは最近開いた順で決めるが、並べる順は id で固定する。
  // 並びが変わると React が要素を付け替え、付け替えられたスレ表示はスクロール位置が一番上に戻ってしまうため
  const shownIds = (paneId && !keptIds.includes(paneId) ? [paneId, ...keptIds] : keptIds)
    .filter((id) => aliveIds.has(id))
    .slice(0, KEEP_TABS)
    .sort()

  const tabEvents: TabEvents = {
    savePosition: useEvent((id: string, pos: ScrollPosition) => patchTab(id, { scroll: pos })),
    markRead,
    refresh: useEvent(() => void refreshThread()),
    openInBrowser: useEvent((t: ThreadSummary) => void openUrl(connectorOf(t.connectorId).threadWebUrl(t))),
    openUrl: useEvent((url: string) => void openLink(url)),
    addNg: useEvent((rule: NgRule) => addNg(rule)),
    markTroll: useEvent((t: ThreadSummary, p: Post, troll: boolean | null, reason?: string) => markTroll(t, p, troll, reason)),
    ngDraft: useEvent((target: NgTarget, text: string, values?: Partial<Record<NgTarget, string>>) => setNgDraft({ target, pattern: text, values })),
    canPost: useEvent((t: ThreadSummary) => connectorOf(t.connectorId).createPost !== undefined),
    submitPost: useEvent((input: PostInput) => submitPost(input)),
    confirmPost: useEvent((c: PostConfirm, input: PostInput) => confirmPost(c, input)),
    changeReplyLayout: useEvent((layout: ReplyLayout) => updateSetting('replyLayout', layout)),
    resizeReply: useEvent((key: 'replyHeight' | 'replyWidth', size: number) => updateSetting(key, size)),
    setReplyCollapsed: useEvent((collapsed: boolean) => updateSetting('replyCollapsed', collapsed)),
    backToList: useEvent(() => returnToList()),
    openDrawer: isMobile ? () => setDrawerOpen(true) : undefined,
    // スレ表示の削除ボタン。1 画面のときは、消したあとスレ一覧に戻る(タブの × や Delete キーは、隣のタブに移る)
    deleteLog: useEvent((id: string) => {
      if (!single) return void deleteLogs([id])
      void deleteLogs([id], [], true)
      returnToList()
    }),
    uploaded: useEvent((u: { url: string; name: string; size: number; withAccount: boolean }) => {
      setHasUploads(true)
      void store?.addUpload(u).catch(backgroundError('アップロード履歴の保存'))
    }),
    openNextUnread: useEvent(() => {
      const next = nextUnreadRef.current
      if (next) void openThread(next.thread)
    }),
    findNext: useEvent(async (t: ThreadSummary, title: string) => {
      const list = await connectorOf(t.connectorId).listThreads({ connectorId: t.connectorId, url: t.boardUrl, name: '' }, ctx)
      // その板を開いていれば、取り直したスレ一覧も見せる
      if (boardRef.current?.url === t.boardUrl) setThreads(list)
      return findNextThreads({ key: t.key, title, createdAt: t.createdAt }, list)
    }),
    openThread: useEvent((t: ThreadSummary) => void openThread(t, { newTab: true })),
    toggleFavoriteThread: useEvent((t: ThreadSummary) => toggleFavoriteThread(t)),
    togglePostAccount: useEvent((id: string, on: boolean) => updateSetting('postAccounts', { ...settings.postAccounts, [id]: on })),
    openAccountSettings: useEvent(() => setSettingsTab('accounts')),
    threadUrl: useEvent((t: ThreadSummary) => connectorOf(t.connectorId).threadWebUrl(t)),
    // ︙ の「板に戻る」: そのスレの板のスレ一覧を開く(お気に入りの板ならその設定のまま、なければ URL から調べて)
    setThreadHeaderHeight: useEvent((h: number) => updateSetting('threadHeaderHeight', h)),
    // 自分の書き込みを消す(確かめてから)
    deletePost: useEvent((t: ThreadSummary, p: Post) => setPostDeleteConfirm({ t, p })),
    // 反応(そうだね・いいねなど)を押した: 返ってきた新しい数をタブに写す
    react: useEvent((t: ThreadSummary, p: Post, reactionId: string) => {
      const c = findConnector(t.connectorId)
      if (!c?.react) return
      const label = c.reactions?.find((r) => r.id === reactionId)?.label ?? reactionId
      void c.react(t, p, reactionId, ctx).then(
        (n) => {
          const id = threadId(t)
          const key = p.ref ?? p.no
          setTabs((ts) =>
            ts.map((x) => (x.id === id ? { ...x, reactions: new Map(x.reactions ?? []).set(key, { ...x.reactions?.get(key), [reactionId]: n }) } : x)),
          )
        },
        backgroundError(label),
      )
    }),
    // レスへの操作(通報など): 確かめる文があれば確かめてから
    postAction: useEvent((t: ThreadSummary, p: Post, actionId: string) => {
      const def = findConnector(t.connectorId)?.postActions?.find((a) => a.id === actionId)
      if (!def) return
      if (def.confirm) setPostActionConfirm({ t, p, def })
      else runPostAction(t, p, def)
    }),
    openBoardOf: useEvent((t: ThreadSummary) => {
      const fav = favorites?.find((b) => b.url === t.boardUrl)
      if (fav) void openBoard(fav)
      else void openUrlInApp(t.boardUrl)
    }),
    updateSetting: useEvent(((key, value) => updateSetting(key, value)) as UpdateSetting),
    registerReadFlush: useEvent((flush: (() => void) | undefined) => {
      readFlush.current = flush
    }),
    loadDraft: useEvent(async (t: ThreadSummary) => store?.getDraft(t)),
    saveDraft: useEvent((t: ThreadSummary, body: string) => void store?.setDraft(t, body).catch(backgroundError('下書きの保存'))),
  }
  // 中身の関数はどれも変わらないので、入れ物も一度だけ作る(TabPane の memo が効くように)
  const tabEventsRef = useRef(tabEvents)
  const stableTabEvents = tabEventsRef.current

  const historyStates = new Map(history?.map((h) => [threadId(h.thread), h as ThreadState]))
  // 履歴のスレの並びは、履歴が変わったときだけ作る(描き直しのたびに作ると、スレ一覧が勢いを計算し直してしまう)
  // スレ一覧から分かったレス数があれば、それを使う(手元のレス数より多いぶんが未読として出る)
  const historyThreads = useMemo(
    () =>
      history?.map((h) => {
        const n = historyCounts.get(threadId(h.thread))
        return n !== undefined && n > h.thread.postCount ? { ...h.thread, postCount: n } : h.thread
      }),
    [history, historyCounts],
  )
  // お気に入りのスレ。ログのないスレ(足しただけでまだ開いていない)には状態を付けない(既読の線を出さない)
  const favStates = new Map(favThreads.filter((f) => f.postCount > 0).map((f) => [threadId(f.thread), f as ThreadState]))
  const favListThreads = useMemo(
    () =>
      favThreads.map((f) => {
        const n = favCounts.get(threadId(f.thread))
        return n !== undefined && n > f.thread.postCount ? { ...f.thread, postCount: n } : f.thread
      }),
    [favThreads, favCounts],
  )
  /** サイドバーに出す、お気に入りのスレの新着の合計 */
  const favNewTotal = favThreads.reduce((sum, f) => {
    if (f.postCount === 0) return sum
    const n = favCounts.get(threadId(f.thread)) ?? f.postCount
    return sum + Math.max(0, n - f.readNo)
  }, 0)
  const stateOf = favView
    ? (t: ThreadSummary) => favStates.get(threadId(t))
    : history
      ? (t: ThreadSummary) => historyStates.get(threadId(t))
      : (t: ThreadSummary) => (t.boardUrl === board?.url ? states.get(t.key) : undefined)
  const isFavorite = !!board && !!favorites?.some((f) => f.url === board.url)
  const listTitle = favView ? 'お気に入りのスレ' : history ? '閲覧履歴' : board ? settings.boardMeta[board.url]?.alias || board.name : undefined
  // スレの最後の「次の未読スレへ」。いまのスレ一覧に見えている並びで、いまのスレの次に未読のあるスレ。
  // 未読の数は一覧の「+n」と同じ見方(読んだことのないスレは数えない)。タブで開いているスレは、タブの既読・レス数のほうが新しい
  const nextUnread = nextUnreadThread(shownList, activeId, threadId, (t) => {
    const st = stateOf(t)
    if (!st) return 0
    const tab = tabs.find((x) => x.id === threadId(t))
    return Math.max(0, Math.max(t.postCount, tab?.log?.postCount ?? 0) - Math.max(st.readNo, tab?.readNo ?? 0))
  })
  nextUnreadRef.current = nextUnread
  const listPlacements = useMemo(
    () => resolvePlacements('list', isMobile ? settings.mobileBarLayout : settings.barLayout, isMobile),
    [settings.barLayout, settings.mobileBarLayout],
  )

  const currentUrl = activeTab
    ? connectorOf(activeTab.thread.connectorId).threadWebUrl(activeTab.thread)
    : (board?.url ?? '')

  return (
    // isolate: 背景画像(-z-10)を、この枠の背景の上・パネルの下に置くため
    // 一番上にアドレスバーの帯をウィンドウの幅いっぱいに置き、その下にサイドバーと本体を並べる
    <div className="relative isolate flex flex-col h-full w-full overflow-hidden bg-c-base text-c-text-body">
      {/* 背景画像。パネルの後ろに置き、パネルを透かしたところに見える */}
      {settings.backgroundImage && settings.backgroundOpacity > 0 && (
        <div
          className="absolute inset-0 -z-10 pointer-events-none bg-cover bg-center"
          style={{
            backgroundImage: `url("${backgroundImageUrl(settings.backgroundImage)}")`,
            opacity: settings.backgroundOpacity,
          }}
        />
      )}
      {/* スマホでは URL 欄の帯は出さない(URL は引き出しの「URL を開く」から) */}
      {!isMobile && (
      <AddressBar
        currentUrl={currentUrl}
        onOpen={(url) => void openUrlInApp(url)}
        onBack={() => goNav(-1)}
        onForward={() => goNav(1)}
        canBack={canBack(view.current)}
        canForward={canForward(view.current)}
      />
      )}
      {/* スマホ: 横になぞる動きをスクロールにしない(縦のスクロールと、2 本指の拡大だけ任せる)。
          こうしないと、なぞっている途中でスクロールが始まり、→↓ のような折れ曲がるなぞりが取れない */}
      <div className="flex-1 min-h-0 flex" style={isMobile ? { touchAction: 'pan-y pinch-zoom' } : undefined}>
      {/* スマホ: なぞっている間、何の操作になるかを真ん中に出す */}
      {swipe.label && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center pointer-events-none">
          <span className="px-4 py-2 rounded-full bg-black/70 text-white text-sm font-bold">{swipe.label}</span>
        </div>
      )}
      {/* スマホでは、サイドバーは画面の上に重ねる引き出しにする(ふだんは出さない)。
          画面の部品の重なりに巻き込まれないよう、body の直下に出す */}
      {(!isMobile || drawerOpen) &&
        (isMobile ? (drawer: ReactNode) => createPortal(drawer, document.body) : (drawer: ReactNode) => drawer)(
      <div className={isMobile ? 'fixed inset-0 z-[9000]' : 'contents'} data-drawer={isMobile ? '' : undefined}>
      {isMobile && <div className="absolute inset-0 bg-black/40 drawer-fade" onClick={() => setDrawerOpen(false)} />}
      {/* flex: サイドバーの外枠を縦いっぱいに伸ばす(中身は外枠の高さに合わせて置くので、伸ばさないと高さが 0 になって見えない) */}
      {/* スマホ: 時刻の帯・ジェスチャーの帯の分だけ内側に寄せ、スレ一覧・スレ表示のヘッダーと同じ高さから始める(寄せた分はヘッダーの色で塗る) */}
      <div
        className={isMobile ? 'absolute inset-y-0 left-0 flex drawer-slide' : 'contents'}
        style={isMobile ? { paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)', background: 'var(--tab-active-bg)' } : undefined}
      >
      <div className={isMobile ? 'flex' : 'contents'} style={isMobile ? { zoom: DRAWER_ZOOM } : undefined}>
      <Sidebar
        neighbor={single ? 'view' : 'list'}
        // スマホは中身を少し拡大して(下の zoom)、ほかの画面の字の大きさにそろえる。拡大する分、幅は割り戻す
        width={isMobile ? Math.round(Math.min(340, window.innerWidth * 0.86) / DRAWER_ZOOM) : settings.sidebarWidth}
        onResize={(w) => updateSetting('sidebarWidth', w)}
        favorites={favorites ?? []}
        onReorderFavorites={(urls) =>
          void run(null, async () => {
            if (!store || !favorites) return
            // 先に並べ替えて見せてから保存する
            setFavorites(urls.map((u) => favorites.find((f) => f.url === u)!).filter(Boolean))
            await store.reorderFavorites(urls)
          })
        }
        recentHistory={recentHistory}
        onOpenThread={(t) => void openThread(t)}
        onDeleteHistory={(t) => void deleteLogs([], [t])}
        showStripNames={settings.showStripNames}
        onOpenUploads={settings.uploaderEnabled || hasUploads ? () => void openUploads() : undefined}
        onOpenPostHistory={() => void openPostHistory()}
        activeBoardUrl={board?.url}
        onOpenBoard={openBoard}
        onToggleFavorite={toggleFavorite}
        collapsed={isMobile ? false : settings.sidebarCollapsed}
        onToggleCollapsed={() => updateSetting('sidebarCollapsed', !settings.sidebarCollapsed)}
        boardMeta={settings.boardMeta}
        historyActive={history !== undefined}
        onOpenHistory={() => void openHistory()}
        favThreadsActive={favView}
        favThreadsNew={favNewTotal}
        onOpenFavThreads={() => void openFavThreads()}
        onOpenSettings={() => setSettingsTab('display')}
        onManageBoards={() => setSettingsTab('boardlist')}
        onOpenUrl={isMobile ? () => setUrlPrompt('') : undefined}
      />
      </div>
      </div>
      </div>,
        )}

      <div className="flex-1 min-w-0 flex flex-col">
      {/* overflow-hidden: しまったスレ一覧がサイドバーの上にはみ出して見えないように */}
      <div className="relative flex-1 min-h-0 flex overflow-hidden">

      {/* 1 画面のときは、スレ一覧を土台として画面いっぱい(読みやすい幅で真ん中)に出し、
          スレを開くとスレ表示がその上に右から重なる(下の threadShown) */}
      {settingsLoaded && (
        <div
          className={
            single
              ? // スマホ: スレを開くとスレ一覧は少し左へ逃げ、閉じると左から戻ってくる(元の Web アプリと同じ)
                // will-change: 動かす層を最初から分けておき、開く・戻るときのすべりを軽くする
                `flex-1 min-w-0 flex justify-center bg-panel-view ${isMobile ? `will-change-transform transition-transform duration-[250ms] ease-out ${threadShown ? '-translate-x-1/4' : ''}` : ''}`
              : 'relative flex flex-shrink-0'
          }
          onPointerDownCapture={() => setFocusPane('list')}
        >
        {!single && <FocusLine on={listFocused} />}
        <ThreadListPanel
          key={favView ? 'favorites' : history ? 'history' : board?.url}
          active={listFocused}
          keymap={keymap}
          headerHeight={settings.listHeaderHeight}
          footerHeight={settings.listFooterHeight}
          onHeaderHeight={(h) => updateSetting('listHeaderHeight', h)}
          onFooterHeight={(h) => updateSetting('listFooterHeight', h)}
          variant={baseVariant(effectivePostStyle(settings))}
          authorIcon={settings.threadAuthorIcon}
          compact={settings.listShape === 'compact'}
          title={listTitle ?? '板を選択'}
          onShownChange={onShownChange}
          threads={favView ? favListThreads : (historyThreads ?? threads)}
          stateOf={stateOf}
          activeId={activeId}
          loading={loading.has('threads')}
          emptyText={
            favView
              ? 'お気に入りのスレはありません(スレの ☆ で足せます)'
              : history
                ? '閲覧履歴はありません'
                : board
                  ? 'スレッドがありません'
                  : '左のお気に入りから板を選んでください'
          }
          onOpen={(t) => void openThread(t)}
          onRefresh={
            favView
              ? manualListRefresh(refreshFavThreads)
              : history
                ? // 閲覧履歴の更新は時間がかかるので、引っぱったときの丸い矢印は待たずに引っ込め、ヘッダーの下の帯だけで知らせる
                  manualListRefresh(() => {
                    void refreshHistory()
                  })
                : board
                  ? manualListRefresh(() => openBoard(board, false))
                  : undefined
          }
          refreshReadyAt={listReadyAt}
          // 縦長のときは、引き出してもスレ表示が少し見えるように、ウィンドウの 85% までにする
          width={settings.threadPanelWidth}
          // 狭くて自動で 1 画面になったときは幅いっぱいに。設定で 1 画面にしたときは読みやすい幅で真ん中に
          fill={single ? (settings.paneMode === 'single' ? 'centered' : 'full') : undefined}
          onResize={(w) => updateSetting('threadPanelWidth', w)}
          defaultSort={favView || history ? 'subject' : settings.threadSort}
          onOpenDrawer={isMobile ? () => setDrawerOpen(true) : undefined}
          serverOrder={!favView && !history && listOrder ? orderOf(listOrder) : undefined}
          onSortChange={!favView && !history ? onListSort : undefined}
          // 閲覧履歴は、見た順と未読だけ(新しい順・勢い順は、見たスレを並べるのには要らない)
          tabs={history ? ['viewed', 'unread'] : settings.listTabs}
          tabLabel={settings.listTabLabel}
          isNg={isNgThread}
          favorite={!favView && !history && board ? { active: isFavorite, onToggle: () => toggleFavorite(board) } : undefined}
          boardUrl={!favView && !history ? board?.url : undefined}
          onOpenExternal={(url) => void openUrl(url)}
          pullToRefresh={settings.pullToRefreshList}
          hideBarsOnScroll={settings.hideBarsOnScroll}
          newSince={!favView && !history ? newSince : undefined}
          favoriteIds={favIds}
          onToggleFavoriteThread={toggleFavoriteThread}
          onDeleteLogs={history ? (list) => void deleteLogs([], list) : undefined}
          onNgThread={(t) => setNgDraft({ target: 'threadTitle', pattern: t.title, values: { threadTitle: t.title, posterId: t.authorId } })}
          onDeleteThreadLog={(t) => void deleteLogs([], [t])}
          threadUrl={(t) => connectorOf(t.connectorId).threadWebUrl(t)}
          keywords={favView || history ? undefined : settings.keywords}
          snapshotKey={favView ? favVersion : history ? historyVersion : undefined}
          onNewThread={!favView && !history && board && connectorOf(board.connectorId).createThread ? () => setNewThreadOpen(true) : undefined}
          style={{
            button: (up) => <StyleMenu settings={settings} update={updateSetting} up={up} />,
            items: <StyleMenuItems settings={settings} update={updateSetting} />,
          }}
          fontSize={
            <>
              <FontSizeSlider
                label="スレ一覧の文字"
                value={settings.listFontPx}
                base={baseFontPx(settings)}
                preview={(px) => setCssVar('--list-zoom', String(px / baseFontPx(settings)))}
                onCommit={(px) => updateSetting('listFontPx', px)}
                resettable
              />
              <FontSizeSlider
                label="スレの上下の余白"
                value={settings.listPadPx}
                unset={-1}
                base={cssPx('--thread-card-padding-y', 8)}
                min={0}
                max={24}
                icons={['density_small', 'density_large']}
                preview={(px) => {
                  setCssVar('--list-row-pad', `${px}px`)
                  document.documentElement.setAttribute('data-list-pad', '')
                }}
                onCommit={(px) => updateSetting('listPadPx', px)}
                resettable
              />
              <BarSliders settings={settings} update={updateSetting} />
            </>
          }
          placements={listPlacements}
          barOrder={(isMobile ? settings.mobileBarOrder : settings.barOrder).list}
        />
        </div>
      )}

      <div
        className={
          single
            ? isMobile
              ? // スマホ: 開くときは右からすべり込み、閉じるときは右へすべって出ていく(元の Web アプリと同じ)。
                // 出し切ったら transform を外す(付いたままだと、画面の座標で置くポップアップの位置がずれるため)
                `absolute inset-0 z-30 flex flex-col bg-panel-view shadow-2xl will-change-transform transition-[transform,visibility] duration-[250ms] ease-out ${
                  threadShown ? '' : 'translate-x-full invisible pointer-events-none'
                }`
              : // 1 画面: スレ一覧の上に重ねる。開くときは手前(少し大きく・透けた状態)から画面に貼り付くように、
              // 閉じるときはこちらへ近づきながら(大きくなりながら)透けて消える。
              // 出し切ったら動かすための指定(transform)を外す(付いたままだと、画面の座標で置くポップアップの位置がずれるため)。
              // 隠すときも消さずに隠すだけ(読んでいた位置を残すため)
              `absolute inset-0 z-30 flex flex-col bg-panel-view shadow-2xl origin-center transition-[transform,opacity,visibility] duration-200 ease-out ${
                threadShown ? 'opacity-100' : 'scale-[1.06] opacity-0 invisible pointer-events-none'
              }`
            : 'relative flex-1 min-w-0 flex flex-col'
        }
        onPointerDownCapture={() => setFocusPane('thread')}
      >
        {!single && <FocusLine on={!listFocused} />}
        {settings.tabsEnabled && !isMobile && (
        <TabBar
          tabs={tabs.map((t) => ({
            id: t.id,
            title: t.log?.title || t.thread.title,
            // ログのレス数に加えて、スレ一覧などの取り直しで分かった新着も数える(タブを開き直さなくても +n が出る)
            unread: t.log ? Math.max(0, Math.max(t.log.postCount, knownCount(t.id)) - t.readNo) : 0,
            loading: t.loading,
            ended:
              t.log?.status === 'archived' ? 'archived' : t.log && isFull(t.thread, t.log.posts) ? 'full' : undefined,
            boardUrl: t.thread.boardUrl,
            icon: settings.boardMeta[t.thread.boardUrl]?.icon,
          }))}
          activeId={tabPreview ?? activeId}
          onSelect={selectTab}
          onClose={closeTabs}
          onRefreshAll={() => void refreshAll()}
          refreshingAll={refreshingAll}
          onDeleteLogs={(ids) => {
            setSelectedTabs(new Set())
            void deleteLogs(ids)
          }}
          selectedIds={selectedTabs}
          onSelectionChange={setSelectedTabs}
          onReorder={(id, index) =>
            setTabs((ts) => {
              const from = ts.findIndex((t) => t.id === id)
              if (from < 0) return ts
              const next = [...ts]
              const [moved] = next.splice(from, 1)
              next.splice(index, 0, moved)
              return next
            })
          }
        />
        )}

        {/* 最近開いたタブのスレ表示は残しておき、切り替えは見せる・隠すだけにする(作り直さない) */}
        <div className="relative flex-1 min-h-0 flex">
          {switchingPane && <div className="list-progress" aria-label="読み込み中" />}
          {shownIds.map((id) => {
            const found = tabs.find((x) => x.id === id)
            if (!found) return null
            // ログを読み終えるまでは、空のログで外枠(ヘッダー・書き込み欄)だけを出す
            const t = found.log ? found : { ...found, log: placeholderLog(found.thread), loading: true }
            // 1 画面でスレ一覧に戻っているあいだは、隠れているスレ表示を開いていないタブと同じに扱う(キー操作・既読を受けない)
            const isActive = id === paneId && (!single || threadShown)
            return (
              <div key={id} className={`absolute inset-0 flex ${id === paneId ? '' : 'invisible pointer-events-none'}`}>
                <TabPane
                  tab={t as Tab & { log: ThreadLog }}
                  active={isActive}
                  keyFocus={!listFocused}
                  settings={settings}
                  isNg={isNgPost}
                  trollMarks={trollMarks}
                  trollJudge={trollJudge}
                  nonameName={boardInfos.get(t.thread.boardUrl)?.nonameName}
                  jumpTo={jump?.tabId === id ? jump : undefined}
                  favorite={favIds.has(id)}
                  postReadyAt={postReadyAt}
                  postCooldownMs={postCooldownMs}
                  postAccounts={postAccountsOf(t.thread.connectorId, t.thread.boardUrl)}
                  showBackToList={single}
                  postLimits={boardInfos.get(t.thread.boardUrl)?.limits}
                  postByteLength={findConnector(t.thread.connectorId)?.postByteLength}
                  maxPosts={findConnector(t.thread.connectorId)?.maxPosts}
                  anchorTarget={findConnector(t.thread.connectorId)?.anchorTarget}
                  reactionDefs={findConnector(t.thread.connectorId)?.reactions}
                  postActions={findConnector(t.thread.connectorId)?.postActions}
                  textQuotes={findConnector(t.thread.connectorId)?.textQuotes}
                  attachments={findConnector(t.thread.connectorId)?.attachments}
                  canReact={!!findConnector(t.thread.connectorId)?.react}
                  canDeletePost={!!findConnector(t.thread.connectorId)?.deletePost}
                  splitPostIcon={findConnector(t.thread.connectorId)?.splitPostIcon}
                  // 次の未読スレは、いま開いているタブにだけ渡す(ほかのタブを描き直さないように、中身は文字と数だけ)
                  nextUnreadTitle={isActive && listTitle !== undefined ? (nextUnread?.thread.title ?? '') : undefined}
                  nextUnreadCount={isActive ? nextUnread?.unread : undefined}
                  nextListTitle={isActive ? listTitle : undefined}
                  ev={stableTabEvents}
                />
              </div>
            )
          })}
          {!activeTab && (
            <main className="absolute inset-0 flex items-center justify-center bg-panel-view">
              <div className="text-c-text-muted text-sm">スレッドを選択してください</div>
            </main>
          )}
        </div>
      </div>
      </div>
      </div>
      </div>

      {postHistory && (
        <PostHistoryDialog
          entries={postHistory}
          onOpen={(e) => {
            setPostHistory(undefined)
            // スレを開いてから、番号が分かっていればそのレスへ飛ぶ(開いたときの位置合わせのあとに)
            void openThread(e.thread).then(() => {
              if (e.no !== undefined) setJump({ tabId: threadId(e.thread), no: e.no, seq: Date.now() })
            })
          }}
          onDelete={async (id) => {
            if (!store) return
            await store.deletePostHistory(id)
            setPostHistory(await store.listPostHistory())
          }}
          onClose={() => setPostHistory(undefined)}
        />
      )}
      {uploads && (
        <UploadHistoryDialog
          uploads={uploads}
          onOpen={(url) => void (isMobile ? openUrlInApp(url) : openUrl(url))}
          canDelete={settings.catboxUserhash.trim() !== ''}
          onDelete={async (url) => {
            if (!store) return
            // サーバー上で消せてから、履歴からも外す
            await deleteFromCatbox(url, settings.catboxUserhash.trim())
            await store.removeUpload(url)
            setUploads(await store.listUploads())
          }}
          onClose={() => setUploads(undefined)}
        />
      )}

      <Notifications items={notifications} onClose={dismiss} />

      {readerUrl && (
        <ReaderView
          url={readerUrl}
          // ウェブページはブラウザの名乗り(User-Agent)で取る(専ブラの名乗りだと、スマホ向けでない・断られるページがある)
          fetchPage={(url) => ctx.http.get(url, { headers: { 'User-Agent': BROWSER_UA } })}
          saveDir={settings.imageSaveDir}
          onClose={() => setReaderUrl(undefined)}
          onOpenExternal={(url) => void openUrl(url)}
        />
      )}
      {urlPrompt !== undefined && (
        <UrlPrompt
          onClose={() => setUrlPrompt(undefined)}
          onOpen={(url) => {
            setUrlPrompt(undefined)
            void openUrlInApp(url)
          }}
        />
      )}
      {postActionConfirm && (
        <ConfirmDialog
          title={postActionConfirm.def.label}
          message={postActionConfirm.def.confirm!}
          okLabel={postActionConfirm.def.label}
          onClose={(ok) => {
            const { t, p, def } = postActionConfirm
            setPostActionConfirm(undefined)
            if (ok) runPostAction(t, p, def)
          }}
        />
      )}
      {postDeleteConfirm && (
        <ConfirmDialog
          title="書き込みを削除"
          message={`No.${postDeleteConfirm.p.ref ?? postDeleteConfirm.p.no} の書き込みを、掲示板から削除します。\n元に戻せません。`}
          okLabel="削除"
          onClose={(ok) => {
            const { t, p } = postDeleteConfirm
            setPostDeleteConfirm(undefined)
            const c = findConnector(t.connectorId)
            if (!ok || !c?.deletePost) return
            if (!settings.postDeleteKey) return notify({ icon: 'error', title: '削除できません', body: 'このアプリで書いたときの削除キーがありません' })
            void c.deletePost(t, p, settings.postDeleteKey, ctx).then(
              (r) =>
                notify(
                  r.status === 'ok'
                    ? { icon: 'delete', title: '書き込みを削除しました', body: '掲示板のページで確かめられます(このアプリの表示は、次に開き直したときに変わります)' }
                    : { icon: 'error', title: '削除できませんでした', body: r.message },
                ),
              backgroundError('書き込みの削除'),
            )
          }}
        />
      )}
      {deleteConfirm && (
        <ConfirmDialog
          title="ログを削除"
          message={`${deleteConfirm.length} 件のスレのログを削除して閉じます。\n読んだ位置や、dat 落ちして取り直せないレスも消えます。`}
          okLabel="削除"
          canSkipNext
          onClose={(ok, skipNext) => {
            const ids = deleteConfirm
            setDeleteConfirm(undefined)
            if (!ok) return
            if (skipNext) updateSetting('confirmDeleteLog', false)
            setSelectedTabs(new Set())
            void deleteLogs(ids)
          }}
        />
      )}
      {paletteOpen && <CommandPalette items={paletteItems()} onClose={() => setPaletteOpen(false)} />}
      {keyHelpOpen && <KeyHelp keymap={keymap} onClose={() => setKeyHelpOpen(false)} />}
      {baseFontDialog && (
        <SliderDialog title="文字サイズ" onClose={() => setBaseFontDialog(false)}>
          <FontSizeSlider
            label="画面全体"
            value={baseFontPx(settings)}
            base={baseFontPx(settings)}
            preview={(px) => (document.documentElement.style.fontSize = `${px}px`)}
            onCommit={(px) => updateSetting(FONT_PX_KEY, px)}
          />
        </SliderDialog>
      )}
      {ngDraft && <NgRuleDialog draft={ngDraft} onSubmit={addNg} onClose={() => setNgDraft(undefined)} />}

      {newThreadOpen && board && (
        <NewThreadDialog
          attach={findConnector(board.connectorId)?.attachments}
          boardName={settings.boardMeta[board.url]?.alias || board.name}
          draftKey={`new:${board.url}`}
          initialName={settings.boardMeta[board.url]?.defaultName ?? settings.postName}
          initialMail={settings.boardMeta[board.url]?.defaultMail ?? settings.postMail}
          onSubmit={createThread}
          onConfirm={confirmThread}
          onOpenUrl={(url) => void openUrl(url)}
          onClose={() => setNewThreadOpen(false)}
          readyAt={postReadyAt}
          cooldownMs={postCooldownMs}
          uploader={
            settings.uploaderEnabled
              ? {
                  stripMetadata: settings.uploadStripMetadata,
                  maxDimension: settings.uploadMaxDimension,
                  userhash: settings.catboxUserhash.trim() || undefined,
                }
              : undefined
          }
          onUploaded={stableTabEvents.uploaded}
          accounts={postAccountsOf(board.connectorId, board.url)}
          limits={boardInfos.get(board.url)?.limits}
          byteLength={findConnector(board.connectorId)?.postByteLength}
          onToggleAccount={stableTabEvents.togglePostAccount}
          onOpenAccountSettings={() => {
            setNewThreadOpen(false)
            setSettingsTab('accounts')
          }}
        />
      )}

      {settingsTab && isMobile && (
        // スマホは、スマホ用に別に作った設定画面。アカウント・板の一覧から開いたときだけその画面から、ほかはトップから
        <MobileSettings
          initialPage={settingsTab === 'accounts' ? 'accounts' : settingsTab === 'boardlist' ? 'boards' : 'home'}
          loadBoards={loadBoards}
          onToggleFavorite={(b) => void toggleFavorite(b)}
          onOpenBoard={(b) => {
            setSettingsTab(undefined)
            void openBoard(b)
          }}
          settings={settings}
          update={updateSetting}
          favorites={favorites ?? []}
          sites={sites}
          onAddFavoriteUrl={addFavoriteUrl}
          onRemoveFavorite={(url) =>
            void run(null, async () => {
              if (!store) return
              await store.removeFavorite(url)
              await reloadFavorites(store)
            })
          }
          onAddSite={addSite}
          onRemoveSite={removeSite}
          accounts={accounts}
          loginStatus={loginStatus}
          onLogin={saveAndLogin}
          onDeleteAccount={(c, a) => void run(null, () => deleteAccount(c, a))}
          onBackupDb={() => (store ? backupDatabase(store) : Promise.resolve(false))}
          onRestoreDb={restoreDatabase}
          onPruneLogs={pruneLogs}
          externalConnectors={externalConnectors}
          onReloadConnectors={(approvals) => reloadExternalConnectors(approvals)}
          onOpenConnectorsDir={() => undefined}
          onClose={() => setSettingsTab(undefined)}
        />
      )}
      {settingsTab && !isMobile && (
        <SettingsDialog
          initialTab={settingsTab}
          loadBoards={loadBoards}
          onToggleFavorite={(b) => void toggleFavorite(b)}
          onOpenBoard={(b) => {
            setSettingsTab(undefined)
            void openBoard(b)
          }}
          settings={settings}
          update={updateSetting}
          favorites={favorites ?? []}
          sites={sites}
          onAddFavoriteUrl={addFavoriteUrl}
          onRemoveFavorite={(url) =>
            void run(null, async () => {
              if (!store) return
              await store.removeFavorite(url)
              await reloadFavorites(store)
            })
          }
          onAddSite={addSite}
          onRemoveSite={removeSite}
          accounts={accounts}
          loginStatus={loginStatus}
          onLogin={saveAndLogin}
          onDeleteAccount={(c, a) => void run(null, () => deleteAccount(c, a))}
          onBackupDb={() => (store ? backupDatabase(store) : Promise.resolve(false))}
          onRestoreDb={restoreDatabase}
          onPruneLogs={pruneLogs}
          externalConnectors={externalConnectors}
          onReloadConnectors={(approvals) => reloadExternalConnectors(approvals)}
          onOpenConnectorsDir={() => void connectorsDir().then(revealItemInDir).catch(backgroundError('コネクタのフォルダを開く'))}
          onClose={() => setSettingsTab(undefined)}
        />
      )}

      {error && (
        <div
          className="fixed bottom-4 right-4 z-[9999] max-w-md flex items-start gap-2 px-4 py-3 bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl text-sm"
          role="alert"
        >
          <span className="material-symbols-outlined text-lg text-c-heat-very-hot">error</span>
          <span className="flex-1 text-c-text-body break-all whitespace-pre-wrap">{error}</span>
          <button type="button" onClick={() => setError(undefined)} className="text-c-text-muted hover:text-c-text-strong">
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
      )}
    </div>
  )
}

/** 2 画面のとき、キー操作を受け取っている方(スレ一覧・スレ表示)の上辺に引く線 */
function FocusLine({ on }: { on: boolean }) {
  return (
    <span
      className={`absolute top-0 left-0 right-0 h-[3px] bg-c-accent z-40 pointer-events-none transition-opacity duration-150 ${on ? 'opacity-100' : 'opacity-0'}`}
    />
  )
}

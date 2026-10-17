// 画面全体: サイドバー(板一覧)/ スレ一覧パネル / タブとスレ表示 の 3 カラム。
// データの流れはここに集め、見た目は components/ の各部品(web 版から移植)に任せる。
// ログは SQLite(LogStore)に保存し、開いたスレは手元のログを先に出してから差分を取りに行く。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  builtinConnectors,
  findConnector,
  type Board,
  type BoardInfo,
  type NewThreadInput,
  type PostConfirm,
  type PostInput,
  type PostResult,
  type SiteConfig,
  type ThreadSummary,
} from '@bbs-browser/connectors'
import {
  applyFetch,
  type FavoriteThreadEntry,
  type HistoryEntry,
  type LogStore,
  type PostHistoryEntry,
  type ThreadLog,
  type ThreadState,
  type UploadRecord,
} from '@bbs-browser/logstore'
import SettingsDialog, { type SettingsTab } from './components/SettingsDialog'
import AddressBar from './components/AddressBar'
import Notifications from './components/Notifications'
import { anchorsIn, isAppThreadUrl } from './utils/postBody'
import LoadingCenter from './components/LoadingCenter'
import NewThreadDialog from './components/NewThreadDialog'
import NgRuleDialog, { type NgDraft } from './components/NgRuleDialog'
import UploadHistoryDialog from './components/UploadHistoryDialog'
import PostHistoryDialog from './components/PostHistoryDialog'
import Sidebar from './components/Sidebar'
import StyleMenu, { StyleMenuItems } from './components/StyleMenu'
import { resolvePlacements } from './utils/toolbar'
import TabBar from './components/TabBar'
import ThreadListPanel, { threadId } from './components/ThreadListPanel'
import TabPane, { type Tab, type TabEvents } from './components/TabPane'
import type { ScrollPosition } from './components/ThreadView'
import { openLogStore } from './host/logStore'
import { tauriContext as ctx } from './host/tauriContext'
import { useSettings, type FontSize, type ReplyLayout, type SavedTab } from './ui/settings'
import { useNarrow } from './hooks/useNarrow'
import { useEvent } from './hooks/useEvent'
import { useViewState } from './hooks/useViewState'
import { canBack, canForward, nextAfterClose, selectQuietly, showList, showThread, step } from './utils/viewState'
import { useAccounts } from './hooks/useAccounts'
import { useNotifications } from './hooks/useNotifications'
import { useWatchLists } from './hooks/useWatchLists'
import { useKeywordWatch } from './hooks/useKeywordWatch'
import { backgroundImageUrl } from './host/backgroundImage'
import { initFavicons } from './host/favicon'
import { initOgp } from './host/ogp'
import { modalOpen, actionFor, isReloadKey, keyString, resolveKeymap, type KeyAction } from './utils/keymap'
import ConfirmDialog from './components/ConfirmDialog'
import KeyHelp from './components/KeyHelp'
import { findNextThreads } from './utils/nextThread'
import { favIncreases } from './utils/watch'
import { LIST_REFRESH_COOLDOWN_MS, REFRESH_COOLDOWN_MS } from './utils/cooldown'
import { isAppVisible } from './utils/visibility'
import { backgroundError } from './utils/backgroundError'
import { backupDatabase, restoreDatabase } from './host/backup'
import { deleteFromCatbox } from './host/uploader'
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

const connectorOf = (id: string) => {
  const c = findConnector(id)
  if (!c) throw new Error(`コネクタ ${id} がありません`)
  return c
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
  const connector = builtinConnectors.find((c) => c.canHandle(trimmed))
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
  const { notifications, notify, dismiss } = useNotifications()
  /** 通知から、そのタブのそのレスへ飛ぶ */
  const [jump, setJump] = useState<{ tabId: string; no: number; seq: number }>()
  /** NG を登録する画面(元の文字を入れて開く) */
  const [ngDraft, setNgDraft] = useState<NgDraft>()
  /** キー操作の一覧(? キー) */
  const [keyHelpOpen, setKeyHelpOpen] = useState(false)
  /** Shift+Delete で消そうとしているタブ(確かめるダイアログを出している間) */
  const [deleteConfirm, setDeleteConfirm] = useState<string[]>()
  // 縦長のときは、スレ一覧をしまってスレ表示だけにする。スレ一覧は左から引き出す
  const narrow = useNarrow()
  /** 1 画面(スレ一覧とスレ表示のどちらか一方だけを出す)か。設定と、ウィンドウの形で決まる */
  const single = settings.paneMode === 'single' || (settings.paneMode === 'auto' && narrow)
  /** キー操作の割り当て(スレ表示とスレ一覧で同じものを使う) */
  const keymap = useMemo(() => resolveKeymap(settings.keymap), [settings.keymap])
  // ── 画面の状態 ──
  // 選んでいるタブ・1 画面でスレ一覧を出しているか・戻る/進むの履歴。3 つは utils/viewState.ts の関数でいっしょに変える
  const { view, update: updateView } = useViewState<NavValue>()
  const { activeId, listOpen } = view.current

  // 見たもの(スレ一覧・スレ)を見た順に覚え、上の帯の ← →・マウスの戻る/進むボタン・Alt+← → で行き来する
  const goNav = (d: -1 | 1) => {
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
      setHistory(undefined)
      setFavView(false)
      setThreads([])
      // 前回この板の一覧を取った時刻より後に立ったスレに「新」の印を付ける。今回の時刻を次のために覚える
      setNewSince(settingsRef.current.boardVisits[b.url])
      updateSetting('boardVisits', { ...settingsRef.current.boardVisits, [b.url]: Date.now() })
      const [list, st] = await Promise.all([connectorOf(b.connectorId).listThreads(b, ctx), store.getThreadStates(b.url)])
      rememberList(b.url, list)
      setThreads(list)
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
        setTabs((ts) =>
          ts.map((x) => {
            if (x.id !== id) return x
            const unreadFrom = opts.keepUnread ? x.unreadFrom : x.readNo + 1
            if (!changed && x.log && unreadFrom === x.unreadFrom) return x
            return { ...x, log: changed || !x.log ? saved : x.log, unreadFrom }
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
        // スレ一覧の印(レス数・dat 落ち)は、このスレの 1 行だけ書き換える(板全体を読み直さない)
        if (changed && boardRef.current?.url === t.boardUrl)
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
    const replies = log.posts.filter((p) => p.no > beforeCount && !own.has(p.no) && anchorsIn(p.body).some((n) => own.has(n)))
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
    const [local, own] = await Promise.all([s.loadThread(t), s.getOwnPosts(t)])
    patchTab(id, {
      log: local ?? { title: t.title, posts: [], cursor: null, postCount: 0, readNo: 0, status: 'active' },
      unreadFrom: (local?.readNo ?? 0) + 1,
      readNo: local?.readNo ?? 0,
      ownNos: new Set(own),
    })
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
      const inNew = settings.tabsEnabled && (opts.newTab ?? settings.openInNewTab)
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
      await loadTab(store, t)
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
    // タブで開いているスレに加えて、閲覧履歴から選んだスレ(タブにないもの)も消す
    const targets = new Map<string, ThreadSummary>()
    for (const t of tabsRef.current) if (ids.includes(t.id)) targets.set(t.id, t.thread)
    for (const t of extra) targets.set(threadId(t), t)
    // 先に画面から消す(DB の処理を待たない)
    closeTabs([...targets.keys()].filter((id) => tabsRef.current.some((t) => t.id === id)), stayOnList, false)
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
    if (t.log.status === 'archived' || (t.log.posts.at(-1)?.no ?? 0) >= 1000) return
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
  /** Ctrl+E: キー操作を受け取る方を、スレ一覧とスレ表示で入れ替える(1 画面なら見せる方を入れ替える) */
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
        updateSetting('fontSize', Math.min(5, Math.max(1, settings.fontSize + (action === 'zoomIn' ? 1 : -1))) as FontSize)
        return true
      case 'help':
        setKeyHelpOpen(true)
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
      // Ctrl+E: スレ一覧とスレ表示の、キー操作を受け取る方を入れ替える
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        keyRef.current.toggleFocus()
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

  // 開いていたタブを次の起動で戻す。戻したタブは、選んだときに読み込む
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current || !settingsLoaded || !store) return
    restored.current = true
    const ts = settings.openTabs.map((s) => newTab(fromSaved(s)))
    setTabs(ts)
    const active = ts.find((t) => t.id === settings.activeTab) ?? ts[0]
    if (active) {
      updateView((s) => selectQuietly(s, active.id))
      void run('posts', () => loadTab(store, active.thread))
    }
  }, [settingsLoaded, store])

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
  const submitPost = async (input: PostInput): Promise<PostResult> => {
    if (!store || !activeTab) return { status: 'error', message: 'スレを開いていません' }
    const blocked = postBlocked()
    if (blocked) return blocked
    const t = activeTab.thread
    const connector = connectorOf(t.connectorId)
    if (!connector.createPost) return { status: 'error', message: 'この掲示板には書き込めません' }
    const withAccounts = { ...input, accounts: postAccountIds(t.connectorId, t.boardUrl) }
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
    const no =
      r.resNumber ??
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
    const withAccounts = { ...input, accounts: postAccountIds(b.connectorId, b.url) }
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
    if (!isAppThreadUrl(url)) return openUrl(url)
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

  // 起動時に開く板(設定)。設定とお気に入りを読み終えてから一度だけ
  const startupDone = useRef(false)
  useEffect(() => {
    if (startupDone.current || !settingsLoaded || !favorites) return
    startupDone.current = true
    const url = settings.startupBoardUrl === '@last' ? settings.lastBoardUrl : settings.startupBoardUrl
    if (!url) return
    const fav = favorites.find((b) => b.url === url)
    if (fav) void openBoard(fav)
    else void openUrlInApp(url)
  }, [settingsLoaded, favorites, settings.startupBoardUrl])

  // タブを使わなくしたら、開いているスレ以外のタブを閉じる(戻したタブも 1 つにする)
  useEffect(() => {
    if (!settings.tabsEnabled && tabs.length > 1) setTabs((ts) => ts.filter((t) => t.id === activeId).slice(0, 1))
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
    const s: SiteConfig = { connectorId: '2ch-compat', name: name || host, menuUrl }
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
  useEffect(() => {
    if (!activeId) return
    setKeptIds((prev) => [activeId, ...prev.filter((x) => x !== activeId)].slice(0, KEEP_TABS))
  }, [activeId])
  const aliveIds = new Set(tabs.map((t) => t.id))
  // どれを残すかは最近開いた順で決めるが、並べる順は id で固定する。
  // 並びが変わると React が要素を付け替え、付け替えられたスレ表示はスクロール位置が一番上に戻ってしまうため
  const shownIds = (activeId && !keptIds.includes(activeId) ? [activeId, ...keptIds] : keptIds)
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
    ngDraft: useEvent((target: NgTarget, text: string) => setNgDraft({ target, pattern: text })),
    canPost: useEvent((t: ThreadSummary) => connectorOf(t.connectorId).createPost !== undefined),
    submitPost: useEvent((input: PostInput) => submitPost(input)),
    confirmPost: useEvent((c: PostConfirm, input: PostInput) => confirmPost(c, input)),
    changeReplyLayout: useEvent((layout: ReplyLayout) => updateSetting('replyLayout', layout)),
    resizeReply: useEvent((key: 'replyHeight' | 'replyWidth', size: number) => updateSetting(key, size)),
    setReplyCollapsed: useEvent((collapsed: boolean) => updateSetting('replyCollapsed', collapsed)),
    backToList: useEvent(() => returnToList()),
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
    openBoardOf: useEvent((t: ThreadSummary) => {
      const fav = favorites?.find((b) => b.url === t.boardUrl)
      if (fav) void openBoard(fav)
      else void openUrlInApp(t.boardUrl)
    }),
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
  const listPlacements = useMemo(() => resolvePlacements('list', settings.barLayout), [settings.barLayout])

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
      <AddressBar
        currentUrl={currentUrl}
        onOpen={(url) => void openUrlInApp(url)}
        onBack={() => goNav(-1)}
        onForward={() => goNav(1)}
        canBack={canBack(view.current)}
        canForward={canForward(view.current)}
      />
      <div className="flex-1 min-h-0 flex">
      <Sidebar
        width={settings.sidebarWidth}
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
        collapsed={settings.sidebarCollapsed}
        onToggleCollapsed={() => updateSetting('sidebarCollapsed', !settings.sidebarCollapsed)}
        boardMeta={settings.boardMeta}
        historyActive={history !== undefined}
        onOpenHistory={() => void openHistory()}
        favThreadsActive={favView}
        favThreadsNew={favNewTotal}
        onOpenFavThreads={() => void openFavThreads()}
        onOpenSettings={() => setSettingsTab('display')}
        onManageBoards={() => setSettingsTab('boardlist')}
      />

      <div className="flex-1 min-w-0 flex flex-col">
      {/* overflow-hidden: しまったスレ一覧がサイドバーの上にはみ出して見えないように */}
      <div className="relative flex-1 min-h-0 flex overflow-hidden">

      {/* 1 画面のときは、スレ一覧を土台として画面いっぱい(読みやすい幅で真ん中)に出し、
          スレを開くとスレ表示がその上に右から重なる(下の threadShown) */}
      {settingsLoaded && (
        <div
          className={single ? 'flex-1 min-w-0 flex justify-center bg-panel-view' : 'relative flex flex-shrink-0'}
          onPointerDownCapture={() => setFocusPane('list')}
        >
        {!single && <FocusLine on={listFocused} />}
        <ThreadListPanel
          key={favView ? 'favorites' : history ? 'history' : board?.url}
          active={listFocused}
          keymap={keymap}
          variant={settings.postStyle}
          title={favView ? 'お気に入りのスレ' : history ? '閲覧履歴' : board ? settings.boardMeta[board.url]?.alias || board.name : '板を選択'}
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
                ? manualListRefresh(refreshHistory)
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
          isNg={isNgThread}
          favorite={!favView && !history && board ? { active: isFavorite, onToggle: () => toggleFavorite(board) } : undefined}
          pullToRefresh={settings.pullToRefreshList}
          newSince={!favView && !history ? newSince : undefined}
          favoriteIds={favIds}
          onToggleFavoriteThread={toggleFavoriteThread}
          onDeleteLogs={history ? (list) => void deleteLogs([], list) : undefined}
          onNgThread={(title) => setNgDraft({ target: 'threadTitle', pattern: title })}
          onDeleteThreadLog={(t) => void deleteLogs([], [t])}
          threadUrl={(t) => connectorOf(t.connectorId).threadWebUrl(t)}
          keywords={favView || history ? undefined : settings.keywords}
          snapshotKey={favView ? favVersion : history ? historyVersion : undefined}
          onNewThread={!favView && !history && board && connectorOf(board.connectorId).createThread ? () => setNewThreadOpen(true) : undefined}
          style={{
            button: (up) => <StyleMenu settings={settings} update={updateSetting} up={up} />,
            items: <StyleMenuItems settings={settings} update={updateSetting} />,
          }}
          placements={listPlacements}
        />
        </div>
      )}

      <div
        className={
          single
            ? // 1 画面: スレ一覧の上に重ねる。開くときは手前(少し大きく・透けた状態)から画面に貼り付くように、
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
        {settings.tabsEnabled && (
        <TabBar
          tabs={tabs.map((t) => ({
            id: t.id,
            title: t.log?.title || t.thread.title,
            unread: t.log ? Math.max(0, t.log.postCount - t.readNo) : 0,
            loading: t.loading,
            ended:
              t.log?.status === 'archived' ? 'archived' : (t.log?.posts.at(-1)?.no ?? 0) >= 1000 ? 'full' : undefined,
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
          {shownIds.map((id) => {
            const t = tabs.find((x) => x.id === id)
            if (!t?.log) return null
            // 1 画面でスレ一覧に戻っているあいだは、隠れているスレ表示を開いていないタブと同じに扱う(キー操作・既読を受けない)
            const isActive = id === activeId && (!single || threadShown)
            return (
              <div key={id} className={`absolute inset-0 flex ${id === activeId ? '' : 'invisible pointer-events-none'}`}>
                <TabPane
                  tab={t as Tab & { log: ThreadLog }}
                  active={isActive}
                  keyFocus={!listFocused}
                  settings={settings}
                  isNg={isNgPost}
                  nonameName={boardInfos.get(t.thread.boardUrl)?.nonameName}
                  jumpTo={jump?.tabId === id ? jump : undefined}
                  favorite={favIds.has(id)}
                  postReadyAt={postReadyAt}
                  postCooldownMs={postCooldownMs}
                  postAccounts={postAccountsOf(t.thread.connectorId, t.thread.boardUrl)}
                  showBackToList={single}
                  postLimits={boardInfos.get(t.thread.boardUrl)?.limits}
                  postByteLength={findConnector(t.thread.connectorId)?.postByteLength}
                  splitPostIcon={findConnector(t.thread.connectorId)?.splitPostIcon}
                  ev={stableTabEvents}
                />
              </div>
            )
          })}
          {!activeTab?.log && (
            <main className="absolute inset-0 flex items-center justify-center bg-panel-view">
              {activeTab ? <LoadingCenter /> : <div className="text-c-text-muted text-sm">スレッドを選択してください</div>}
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
          onOpen={(url) => void openUrl(url)}
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
      {keyHelpOpen && <KeyHelp keymap={keymap} onClose={() => setKeyHelpOpen(false)} />}
      {ngDraft && <NgRuleDialog draft={ngDraft} onSubmit={addNg} onClose={() => setNgDraft(undefined)} />}

      {newThreadOpen && board && (
        <NewThreadDialog
          boardName={settings.boardMeta[board.url]?.alias || board.name}
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

      {settingsTab && (
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

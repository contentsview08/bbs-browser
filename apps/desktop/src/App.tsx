// 画面全体: サイドバー(板一覧)/ スレ一覧パネル / タブとスレ表示 の 3 カラム。
// データの流れはここに集め、見た目は components/ の各部品(web 版から移植)に任せる。
// ログは SQLite(LogStore)に保存し、開いたスレは手元のログを先に出してから差分を取りに行く。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  builtinConnectors,
  findConnector,
  type Board,
  type NewThreadInput,
  type PostInput,
  type PostResult,
  type SiteConfig,
  type ThreadSummary,
} from '@bbs-browser/connectors'
import type { HistoryEntry, LogStore, ThreadLog, ThreadState } from '@bbs-browser/logstore'
import SettingsDialog, { type SettingsTab } from './components/SettingsDialog'
import AddressBar from './components/AddressBar'
import LoadingCenter from './components/LoadingCenter'
import NewThreadDialog from './components/NewThreadDialog'
import Sidebar from './components/Sidebar'
import StyleMenu from './components/StyleMenu'
import TabBar from './components/TabBar'
import ThreadListPanel, { threadId } from './components/ThreadListPanel'
import ThreadView, { type ScrollPosition } from './components/ThreadView'
import { openLogStore } from './host/logStore'
import { tauriContext as ctx } from './host/tauriContext'
import { useSettings, type SavedTab } from './ui/settings'
import { useNarrow } from './hooks/useNarrow'
import { postMatcher, pruneExpired, threadMatcher, type NgRule } from './utils/ng'

const connectorOf = (id: string) => {
  const c = findConnector(id)
  if (!c) throw new Error(`コネクタ ${id} がありません`)
  return c
}

/** URL を扱えるコネクタで、板(とスレ)に読み替える */
async function resolve(url: string) {
  const connector = builtinConnectors.find((c) => c.canHandle(url))
  const r = connector ? await connector.resolveUrl(url, ctx) : null
  if (!r) throw new Error(`開けない URL です: ${url}`)
  return r
}

type Loading = 'threads' | 'posts'

/** 開いているスレ 1 つぶん */
interface Tab {
  id: string
  thread: ThreadSummary
  /** まだ読み込んでいなければ undefined(起動時に戻したタブは、選ぶまで読み込まない) */
  log?: ThreadLog
  /** 開いた時点の「最初の未読」。「ここから未読」の線を引く位置 */
  unreadFrom: number
  readNo: number
  ownNos: Set<number>
  /** 別のタブへ移ったときに覚えておく、読んでいた位置 */
  scroll?: ScrollPosition
  loading: boolean
}

function newTab(thread: ThreadSummary): Tab {
  return { id: threadId(thread), thread, unreadFrom: 1, readNo: 0, ownNos: new Set(), loading: false }
}

function fromSaved(s: SavedTab): ThreadSummary {
  return { ...s, order: 0, createdAt: s.createdAt === undefined ? undefined : new Date(s.createdAt) }
}

export default function App() {
  const [store, setStore] = useState<LogStore>()
  const [settings, updateSetting, settingsLoaded] = useSettings(store)
  const [sites, setSites] = useState<SiteConfig[]>([])
  const [favorites, setFavorites] = useState<Board[]>()
  const [board, setBoard] = useState<Board>()
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [states, setStates] = useState(new Map<string, ThreadState>())
  const [history, setHistory] = useState<HistoryEntry[]>()
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeId, setActiveId] = useState<string>()
  const [refreshingAll, setRefreshingAll] = useState(false)
  const [loading, setLoading] = useState(new Set<Loading>())
  const [error, setError] = useState<string>()
  /** 開いている設定画面の分類。undefined なら閉じている */
  const [settingsTab, setSettingsTab] = useState<SettingsTab>()
  const [newThreadOpen, setNewThreadOpen] = useState(false)
  // 縦長のときは、スレ一覧をしまってスレ表示だけにする。スレ一覧は左から引き出す
  const narrow = useNarrow()
  const [listOpen, setListOpen] = useState(false)

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

  // 起動: DB を開いてサイト一覧とお気に入りを読む
  useEffect(() => {
    void run(null, async () => {
      const s = await openLogStore()
      const [list, favs] = await Promise.all([s.listSites(), s.listFavorites()])
      setStore(s)
      setSites(list)
      setFavorites(favs)
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
  const reloadStates = async (s: LogStore, boardUrl: string) => {
    const st = await s.getThreadStates(boardUrl)
    if (boardRef.current?.url === boardUrl) setStates(st)
  }

  const lastBoardUrl = useRef(settings.lastBoardUrl)
  lastBoardUrl.current = settings.lastBoardUrl
  const openBoard = (b: Board) =>
    run('threads', async () => {
      if (!store) return
      setListOpen(true) // 縦長のとき、選んだ板のスレ一覧を引き出して見せる
      setBoard(b)
      // 「起動時に前回の板を開く」ために覚えておく
      if (lastBoardUrl.current !== b.url) updateSetting('lastBoardUrl', b.url)
      setHistory(undefined)
      setThreads([])
      const [list, st] = await Promise.all([connectorOf(b.connectorId).listThreads(b, ctx), store.getThreadStates(b.url)])
      setThreads(list)
      setStates(st)
    })

  const openHistory = () =>
    run('threads', async () => {
      setListOpen(true)
      if (store) setHistory(await store.history())
    })

  // ── タブ ──

  const patchTab = (id: string, patch: Partial<Tab>) =>
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  /**
   * スレを取りに行って保存し、そのタブの表示を差し替える。
   * 同じスレを取りに行っている最中なら、それを待つ。force なら、待ったあとでもう一度取りに行く
   * (書き込んだ直後は、自分のレスが入った状態を必ず取りたいので)
   */
  const inflight = useRef(new Map<string, Promise<void>>())
  const fetchThread = async (s: LogStore, t: ThreadSummary, opts: { force?: boolean } = {}) => {
    const id = threadId(t)
    const running = inflight.current.get(id)
    if (running) {
      await running
      if (!opts.force) return
    }
    const job = (async () => {
      patchTab(id, { loading: true })
      try {
        const cursor = (await s.loadThread(t))?.cursor ?? null
        const r = await connectorOf(t.connectorId).fetchPosts(t, cursor, ctx)
        await s.saveFetch(t, r)
        const saved = await s.loadThread(t)
        // 「ここから未読」は、取り直すたびにその時点の既読位置の次へ引き直す
        // (開いた時点の位置のままにすると、読み終えて更新しても線が残り続ける)
        if (saved) setTabs((ts) => ts.map((x) => (x.id === id ? { ...x, log: saved, unreadFrom: x.readNo + 1 } : x)))
        await reloadStates(s, t.boardUrl)
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
    await fetchThread(s, t)
  }

  const selectTab = (id: string) => {
    setActiveId(id)
    const tab = tabsRef.current.find((t) => t.id === id)
    if (store && tab && !tab.log) void run('posts', () => loadTab(store, tab.thread))
  }

  const openThread = (t: ThreadSummary, opts: { newTab?: boolean } = {}) =>
    run('posts', async () => {
      if (!store) return
      const id = threadId(t)
      const existing = tabsRef.current.find((x) => x.id === id)
      if (existing) {
        // もう開いているスレは、そのタブに移って差分を取りに行く(スレ一覧で新着があるのを見て押したとき)
        selectTab(id)
        if (existing.log) await fetchThread(store, existing.thread)
        return
      }
      // タブを使わないときは、いつも今のスレを置き換える
      const inNew = settings.tabsEnabled && (opts.newTab ?? settings.openInNewTab)
      const current = activeId
      setTabs((ts) => {
        const i = ts.findIndex((x) => x.id === current)
        if (i < 0) return [...ts, newTab(t)]
        if (!inNew) return ts.map((x, j) => (j === i ? newTab(t) : x))
        return [...ts.slice(0, i + 1), newTab(t), ...ts.slice(i + 1)]
      })
      setActiveId(id)
      await loadTab(store, t)
      if (history) setHistory(await store.history())
    })

  const closeTabs = (ids: string[]) => {
    const ts = tabsRef.current
    const rest = ts.filter((t) => !ids.includes(t.id))
    setTabs(rest)
    if (activeId && ids.includes(activeId)) {
      // 閉じたタブの右隣(なければ左隣)へ移る
      const idx = ts.findIndex((t) => t.id === activeId)
      const next = rest[Math.min(idx, rest.length - 1)]
      if (next) selectTab(next.id)
      else setActiveId(undefined)
    }
  }

  /** ログを消してタブを閉じる(Delete キー・タブの右クリック・スレ表示のボタン) */
  const deleteLogs = (ids: string[], extra: ThreadSummary[] = []) =>
    run(null, async () => {
      if (!store) return
      // タブで開いているスレに加えて、閲覧履歴から選んだスレ(タブにないもの)も消す
      const targets = new Map<string, ThreadSummary>()
      for (const t of tabsRef.current) if (ids.includes(t.id)) targets.set(t.id, t.thread)
      for (const t of extra) targets.set(threadId(t), t)
      closeTabs([...targets.keys()].filter((id) => tabsRef.current.some((t) => t.id === id)))
      for (const [id, thread] of targets) {
        // 取りに行っている最中なら終わるのを待つ(消したあとに書き戻されないように)
        await inflight.current.get(id)?.catch(() => undefined)
        await store.deleteThread(thread)
      }
      const boardUrl = boardRef.current?.url
      if (boardUrl) await reloadStates(store, boardUrl)
      if (history) setHistory(await store.history())
    })

  const refreshThread = () =>
    run('posts', async () => {
      if (store && activeTab) await fetchThread(store, activeTab.thread)
    })

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

  // 自動更新(開いているタブだけ)。前の取得が終わっていなければその回は飛ばす
  const refreshRef = useRef(refreshThread)
  refreshRef.current = refreshThread
  useEffect(() => {
    if (!activeId || settings.autoRefreshSec <= 0) return
    const id = setInterval(() => void refreshRef.current(), settings.autoRefreshSec * 1000)
    return () => clearInterval(id)
  }, [activeId, settings.autoRefreshSec])

  // キー操作: Ctrl+W で閉じる、Ctrl+Tab / Ctrl+PageDown で次、Ctrl+Shift+Tab / Ctrl+PageUp で前
  // Delete で開いているスレのログを消してタブを閉じる(文字を入力しているときは除く)
  const keyRef = useRef({ closeTabs, selectTab, activeId, deleteLogs })
  keyRef.current = { closeTabs, selectTab, activeId, deleteLogs }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')
      if (e.key === 'Delete' && !typing && !e.ctrlKey && !e.altKey) {
        const { activeId, deleteLogs } = keyRef.current
        if (activeId) {
          e.preventDefault()
          void deleteLogs([activeId])
        }
        return
      }
      if (!e.ctrlKey) return
      const { closeTabs, selectTab, activeId } = keyRef.current
      const ids = tabsRef.current.map((t) => t.id)
      const i = activeId ? ids.indexOf(activeId) : -1
      const step = (d: number) => {
        if (ids.length === 0) return
        e.preventDefault()
        selectTab(ids[(i + d + ids.length) % ids.length])
      }
      if (e.key.toLowerCase() === 'w') {
        e.preventDefault()
        if (e.shiftKey) closeTabs(ids)
        else if (activeId) closeTabs([activeId])
      } else if (e.key === 'Tab') step(e.shiftKey ? -1 : 1)
      else if (e.key === 'PageDown') step(1)
      else if (e.key === 'PageUp') step(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
      setActiveId(active.id)
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
    const t = activeTab.thread
    const connector = connectorOf(t.connectorId)
    if (!connector.createPost) return { status: 'error', message: 'この掲示板には書き込めません' }
    const r = await connector.createPost(t, input, ctx)
    if (r.status !== 'ok') return r

    if (input.name !== settings.postName) updateSetting('postName', input.name)
    if (input.mail !== settings.postMail) updateSetting('postMail', input.mail)
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
    return r
  }

  /**
   * スレ立て。成功したらスレ一覧を取り直して同じスレタイのスレを探し、新しいタブで開く。
   * サーバーの一覧に載るまで少しかかることがあるので、見つからなければ間を置いて探し直す
   */
  const createThread = async (input: NewThreadInput): Promise<PostResult> => {
    if (!store || !board) return { status: 'error', message: '板を開いていません' }
    const b = board
    const connector = connectorOf(b.connectorId)
    if (!connector.createThread) return { status: 'error', message: 'この掲示板ではスレを立てられません' }
    const r = await connector.createThread(b, input, ctx)
    if (r.status !== 'ok') return r

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
        setNewThreadOpen(false)
        await openThread(found, { newTab: true })
        return r
      }
    }
    return { status: 'ok', message: `${r.message}(スレ一覧ではまだ見つかりません。少し待ってから一覧を更新してください)` }
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

  // 期限の切れた一時 NG を片づける
  useEffect(() => {
    if (!settingsLoaded) return
    const kept = pruneExpired(settings.ngRules)
    if (kept.length !== settings.ngRules.length) updateSetting('ngRules', kept)
  }, [settingsLoaded])

  const activeThread = activeTab?.thread
  const markRead = useCallback(
    (no: number) => {
      if (!store || !activeThread) return
      const id = threadId(activeThread)
      setTabs((ts) => ts.map((t) => (t.id === id && no > t.readNo ? { ...t, readNo: no } : t)))
      void store.markRead(activeThread, no).then(() => reloadStates(store, activeThread.boardUrl))
    },
    [store, activeThread],
  )

  // ── お気に入り・サイト ──

  const reloadFavorites = async (s: LogStore) => setFavorites(await s.listFavorites())

  const toggleFavorite = (b: Board) =>
    run(null, async () => {
      if (!store) return
      if (favorites?.some((f) => f.url === b.url)) await store.removeFavorite(b.url)
      else await store.addFavorite({ connectorId: b.connectorId, url: b.url, name: b.name })
      await reloadFavorites(store)
    })

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
  const addNg = useCallback(
    (rule: NgRule) => updateSetting('ngRules', [...settings.ngRules, rule]),
    [settings.ngRules, updateSetting],
  )

  const historyStates = new Map(history?.map((h) => [threadId(h.thread), h as ThreadState]))
  const stateOf = history
    ? (t: ThreadSummary) => historyStates.get(threadId(t))
    : (t: ThreadSummary) => (t.boardUrl === board?.url ? states.get(t.key) : undefined)
  const isFavorite = !!board && !!favorites?.some((f) => f.url === board.url)

  const currentUrl = activeTab
    ? connectorOf(activeTab.thread.connectorId).threadWebUrl(activeTab.thread)
    : (board?.url ?? '')

  return (
    <div className="flex h-full w-full overflow-hidden bg-c-base text-c-text-body">
      <Sidebar
        favorites={favorites ?? []}
        activeBoardUrl={board?.url}
        onOpenBoard={openBoard}
        onToggleFavorite={toggleFavorite}
        collapsed={settings.sidebarCollapsed}
        onToggleCollapsed={() => updateSetting('sidebarCollapsed', !settings.sidebarCollapsed)}
        historyActive={history !== undefined}
        onOpenHistory={openHistory}
        onOpenSettings={() => setSettingsTab('display')}
        onManageBoards={() => setSettingsTab('boardlist')}
      />

      <div className="flex-1 min-w-0 flex flex-col">
      <AddressBar
        currentUrl={currentUrl}
        onOpen={(url) => void openUrlInApp(url)}
        onToggleList={narrow ? () => setListOpen((v) => !v) : undefined}
        listOpen={listOpen}
      />
      <div className="relative flex-1 min-h-0 flex">

      {/* 縦長のときは、スレ一覧を左から引き出す。外を押したら引っ込める */}
      {narrow && listOpen && <div className="absolute inset-0 z-20 bg-black/30" onClick={() => setListOpen(false)} />}
      {settingsLoaded && (
        <div
          className={
            narrow
              ? `absolute inset-y-0 left-0 z-30 flex max-w-[90%] transition-transform duration-200 ease-out ${listOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}`
              : 'contents'
          }
        >
        <ThreadListPanel
          key={history ? 'history' : board?.url}
          title={history ? '閲覧履歴' : (board?.name ?? '板を選択')}
          threads={history ? history.map((h) => h.thread) : threads}
          stateOf={stateOf}
          activeId={activeId}
          loading={loading.has('threads')}
          emptyText={history ? '閲覧履歴はありません' : board ? 'スレッドがありません' : '左のお気に入りから板を選んでください'}
          onOpen={(t) => {
            setListOpen(false)
            void openThread(t)
          }}
          onRefresh={history ? openHistory : board ? () => openBoard(board) : undefined}
          width={settings.threadPanelWidth}
          onResize={(w) => updateSetting('threadPanelWidth', w)}
          defaultSort={history ? 'subject' : settings.threadSort}
          isNg={isNgThread}
          favorite={!history && board ? { active: isFavorite, onToggle: () => toggleFavorite(board) } : undefined}
          onDeleteLogs={history ? (list) => void deleteLogs([], list) : undefined}
          onNewThread={!history && board && connectorOf(board.connectorId).createThread ? () => setNewThreadOpen(true) : undefined}
          actions={<StyleMenu settings={settings} update={updateSetting} />}
        />
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {settings.tabsEnabled && (
        <TabBar
          tabs={tabs.map((t) => ({
            id: t.id,
            title: t.log?.title || t.thread.title,
            unread: t.log ? Math.max(0, t.log.postCount - t.readNo) : 0,
            loading: t.loading,
            archived: t.log?.status === 'archived',
          }))}
          activeId={activeId}
          onSelect={selectTab}
          onClose={closeTabs}
          onRefreshAll={() => void refreshAll()}
          refreshingAll={refreshingAll}
          onDeleteLogs={(ids) => void deleteLogs(ids)}
        />
        )}

        {activeTab?.log ? (
          <ThreadView
            key={activeTab.id}
            log={activeTab.log}
            initialPosition={activeTab.scroll}
            onSavePosition={(pos) => patchTab(activeTab.id, { scroll: pos })}
            unreadFrom={activeTab.unreadFrom}
            loading={activeTab.loading}
            settings={settings}
            isNg={isNgPost}
            onRead={markRead}
            onRefresh={() => void refreshThread()}
            onOpenInBrowser={() => void openUrl(connectorOf(activeTab.thread.connectorId).threadWebUrl(activeTab.thread))}
            onUrl={(url) => void openUrl(url)}
            onAddNg={addNg}
            ownNos={activeTab.ownNos}
            onSubmitPost={connectorOf(activeTab.thread.connectorId).createPost ? submitPost : undefined}
            postName={settings.postName}
            postMail={settings.postMail}
            onChangeReplyLayout={(layout) => updateSetting('replyLayout', layout)}
            onResizeReply={(key, size) => updateSetting(key, size)}
            onDeleteLog={() => void deleteLogs([activeTab.id])}
          />
        ) : (
          <main className="flex-1 flex items-center justify-center bg-c-base">
            {activeTab ? <LoadingCenter /> : <div className="text-c-text-muted text-sm">スレッドを選択してください</div>}
          </main>
        )}
      </div>
      </div>
      </div>

      {newThreadOpen && board && (
        <NewThreadDialog
          boardName={board.name}
          initialName={settings.postName}
          initialMail={settings.postMail}
          onSubmit={createThread}
          onOpenUrl={(url) => void openUrl(url)}
          onClose={() => setNewThreadOpen(false)}
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
          onClose={() => setSettingsTab(undefined)}
        />
      )}

      {error && (
        <div
          className="fixed bottom-4 right-4 z-[9999] max-w-md flex items-start gap-2 px-4 py-3 bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl text-sm"
          role="alert"
        >
          <span className="material-symbols-outlined text-lg text-c-heat-very-hot">error</span>
          <span className="flex-1 text-c-text-body break-all">{error}</span>
          <button type="button" onClick={() => setError(undefined)} className="text-c-text-muted hover:text-c-text-strong">
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
      )}
    </div>
  )
}

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
import SettingsDialog from './components/SettingsDialog'
import NewThreadDialog from './components/NewThreadDialog'
import Sidebar from './components/Sidebar'
import StyleMenu from './components/StyleMenu'
import TabBar from './components/TabBar'
import ThreadListPanel, { threadId } from './components/ThreadListPanel'
import ThreadView, { type ScrollPosition } from './components/ThreadView'
import { openLogStore } from './host/logStore'
import { tauriContext as ctx } from './host/tauriContext'
import { useSettings, type SavedTab } from './ui/settings'
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

type Loading = 'boards' | 'threads' | 'posts'

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
  const [site, setSite] = useState<SiteConfig>()
  const [boards, setBoards] = useState<Board[]>([])
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newThreadOpen, setNewThreadOpen] = useState(false)

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
      setSite(list[0])
      setFavorites(favs)
    })
  }, [])

  const refreshBoards = (s: LogStore, target: SiteConfig) =>
    run('boards', async () => {
      const list = await connectorOf(target.connectorId).listBoards(target, ctx)
      await s.replaceBoards(target.menuUrl, list)
      setBoards(list)
    })

  // サイトを切り替えたら、保存してある板一覧をすぐ出す。なければ取りに行く
  useEffect(() => {
    if (!store || !site) return
    void run('boards', async () => {
      const cached = await store.getBoards(site.menuUrl)
      setBoards(cached)
      if (cached.length === 0) await refreshBoards(store, site)
    })
  }, [store, site])

  // 既読状態は「いま開いている板」のものだけを持つ。別の板のスレを読んでいても混ざらないように
  const boardRef = useRef<Board | undefined>(undefined)
  boardRef.current = board
  const reloadStates = async (s: LogStore, boardUrl: string) => {
    const st = await s.getThreadStates(boardUrl)
    if (boardRef.current?.url === boardUrl) setStates(st)
  }

  const openBoard = (b: Board) =>
    run('threads', async () => {
      if (!store) return
      setBoard(b)
      setHistory(undefined)
      setThreads([])
      const [list, st] = await Promise.all([connectorOf(b.connectorId).listThreads(b, ctx), store.getThreadStates(b.url)])
      setThreads(list)
      setStates(st)
    })

  const openHistory = () =>
    run('threads', async () => {
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
        if (saved) patchTab(id, { log: saved })
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
        selectTab(id)
        return
      }
      const inNew = opts.newTab ?? settings.openInNewTab
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
  const keyRef = useRef({ closeTabs, selectTab, activeId })
  keyRef.current = { closeTabs, selectTab, activeId }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
        if (activeId) closeTabs([activeId])
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
    const url = settings.startupBoardUrl
    if (!url) return
    const fav = favorites.find((b) => b.url === url)
    if (fav) void openBoard(fav)
    else void openUrlInApp(url)
  }, [settingsLoaded, favorites, settings.startupBoardUrl])

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
    setSite(s)
  }

  const removeSite = (menuUrl: string) =>
    run(null, async () => {
      if (!store) return
      await store.removeSite(menuUrl)
      const list = await store.listSites()
      setSites(list)
      if (site?.menuUrl === menuUrl) {
        setSite(list[0])
        if (list.length === 0) setBoards([])
      }
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

  return (
    <div className="flex h-full w-full overflow-hidden bg-c-base text-c-text-body">
      <Sidebar
        sites={sites}
        site={site}
        onSelectSite={setSite}
        boards={boards}
        favorites={favorites ?? []}
        activeBoardUrl={board?.url}
        onOpenBoard={openBoard}
        onToggleFavorite={toggleFavorite}
        onRefreshBoards={() => store && site && refreshBoards(store, site)}
        onOpenUrl={openUrlInApp}
        historyActive={history !== undefined}
        onOpenHistory={openHistory}
        onOpenSettings={() => setSettingsOpen(true)}
        loading={loading.has('boards')}
      />

      {settingsLoaded && (
        <ThreadListPanel
          key={history ? 'history' : board?.url}
          title={history ? '閲覧履歴' : (board?.name ?? '板を選択')}
          threads={history ? history.map((h) => h.thread) : threads}
          stateOf={stateOf}
          activeId={activeId}
          loading={loading.has('threads')}
          emptyText={history ? '閲覧履歴はありません' : board ? 'スレッドがありません' : '左の一覧から板を選んでください'}
          onOpen={(t) => void openThread(t)}
          onRefresh={history ? openHistory : board ? () => openBoard(board) : undefined}
          width={settings.threadPanelWidth}
          onResize={(w) => updateSetting('threadPanelWidth', w)}
          defaultSort={history ? 'subject' : settings.threadSort}
          isNg={isNgThread}
          favorite={!history && board ? { active: isFavorite, onToggle: () => toggleFavorite(board) } : undefined}
          onNewThread={!history && board && connectorOf(board.connectorId).createThread ? () => setNewThreadOpen(true) : undefined}
          actions={<StyleMenu settings={settings} update={updateSetting} />}
        />
      )}

      <div className="flex-1 min-w-0 flex flex-col">
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
        />

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
          />
        ) : (
          <main className="flex-1 flex items-center justify-center bg-c-base">
            <div className="text-c-text-muted text-sm">{activeTab ? '読み込み中...' : 'スレッドを選択してください'}</div>
          </main>
        )}
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

      {settingsOpen && (
        <SettingsDialog
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
          onClose={() => setSettingsOpen(false)}
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
